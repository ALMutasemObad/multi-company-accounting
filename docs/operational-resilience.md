# المهلات والقياسات والتنبيهات التشغيلية

## الهدف والنطاق

توثق هذه الصفحة طبقة المرونة التشغيلية في API. تبدأ ميزانية زمنية مطلقة عند دخول الطلب إلى Express وقبل تحليل JSON، ثم تنتقل عبر `AsyncLocalStorage` إلى أوامر التطبيق و`TransactionExecutor`. لا تضيف الطبقة Queue أو خدمة خارجية، ولا تغير حدود المجالات أو ذرية دفتر الأستاذ.

## هرم المهلات الافتراضي

```text
Reverse proxy / hosting timeout             > 70s
  Node HTTP requestTimeout                   70s
    Registration write application deadline 65s
    Normal write application deadline       15s
    Read application deadline               10s
      Financial transaction timeout          8s
      Financial transaction maxWait          2s
```

القيم Baseline أولي وليست SLA. يختار `TransactionExecutor` أصغر قيمة من:

1. `deadlineAt` المطلق للطلب الحالي.
2. `deadlineAt` الصريح للعملية إن وُجد.
3. `startedAt + deadlineMs` المحلي للعملية.

كل محاولة Retry تستخدم الموعد المطلق نفسه. ويُخفض `maxWait` و`timeout` تلقائيًا إلى الزمن المتبقي، لذلك لا تبدأ محاولة جديدة أو فترة backoff بعد نفاد الميزانية.

`HTTP_REQUEST_TIMEOUT_MS` في Node يحمي استقبال الطلب، أما Deadline التطبيق فيحمي تنفيذ الـhandler وإرسال الاستجابة. يجب ضبط الاثنين؛ أحدهما لا يستبدل الآخر.

## دلالات الانتهاء والانقطاع

- عند انتهاء Deadline يرسل الخادم `504 REQUEST_DEADLINE_EXCEEDED` مرة واحدة إن بقي الاتصال مفتوحًا، ثم يمنع أي استجابة نجاح متأخرة.
- لا تعني `504` يقينًا أن العملية لم تُعتمد: قد يكتمل Commit ذري عند حافة المهلة قبل إمكان إرسال الاستجابة. لذلك يتحقق العميل من الحالة ويعيد الأمر المالي بمفتاح `Idempotency-Key` نفسه.
- لا يقطع التطبيق معاملة بدأت بالفعل قطعًا قسريًا؛ Prisma لا يتيح إلغاء Query آمنًا عبر `AbortSignal` في هذا المسار. يظل transaction timeout هو حاجز rollback، وبعد عودة المعاملة لا تبدأ محاولة أو خطوة تطبيق جديدة إذا كانت الإشارة ملغاة.
- عند إغلاق العميل الاتصال تُلغى الإشارة المشتركة، وتتوقف فترات الانتظار والمحاولات التالية، ويُسجل `http_client_disconnected` داخليًا دون محاولة إرسال Response.
- التسجيل الذاتي يملك Budget أكبر لأن تجهيز الشركة قد يصل إلى 45 ثانية. انتظار تحقق متزامن يستخدم الإشارة نفسها ولا يستمر بعد الانقطاع.

## إعدادات البيئة

| المتغير | الافتراضي | الغرض |
|---|---:|---|
| `HTTP_REQUEST_TIMEOUT_MS` | 70000 | مهلة Node لاستقبال الطلب، ويجب أن تتجاوز أطول Deadline تطبيق بأكثر من ثانية |
| `HTTP_HEADERS_TIMEOUT_MS` | 10000 | أقصى وقت لاستقبال Headers، ولا يتجاوز request timeout |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | 5000 | مدة إبقاء Socket خاملًا بعد الاستجابة |
| `API_READ_DEADLINE_MS` | 10000 | Budget القراءة وHealth والملفات |
| `API_WRITE_DEADLINE_MS` | 15000 | Budget الكتابات العادية والأوامر المالية |
| `API_REGISTRATION_WRITE_DEADLINE_MS` | 65000 | Budget POST تحت `/api/v1/auth/register` |
| `METRICS_ENABLED` | false | تفعيل `GET /metrics` |
| `METRICS_BEARER_TOKEN` | — | سر مستقل بطول 32 حرفًا على الأقل؛ إلزامي في الإنتاج عند تفعيل المسار |

يفشل `loadConfig` مبكرًا إذا انعكس ترتيب المهلات أو فُعّلت القياسات في الإنتاج دون الرمز المستقل.

## Nginx وPassenger

في VPS يضبط Reverse Proxy بمهلة تتجاوز Node وتترك هامشًا للشبكة. Baseline مناسب للقيم الافتراضية:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 75s;
    proxy_read_timeout 75s;
}
```

لا تجعل `proxy_read_timeout` أقصر من `HTTP_REQUEST_TIMEOUT_MS`. وإذا تغير أطول Budget فحدّث التطبيق وNginx معًا واختبر `504` ورفع جسم كبير واتصال keep-alive.

في CloudLinux Passenger يملك مزود الاستضافة طبقة Proxy الخارجية، بينما يظل `server.ts` مسؤولًا عن `requestTimeout` و`headersTimeout` و`keepAliveTimeout`. اضبط القيم نفسها في Node.js Selector، وتأكد من المزود أن مهلة Passenger/Apache الخارجية تتجاوز 70 ثانية. إن تعذر تغييرها، اخفض أطول Budget إلى أقل من مهلة الاستضافة مع إبقاء هرم الإعداد صالحًا؛ لا ترفع Budget التطبيق فوق حد خارجي مجهول.

## مخرج Prometheus الآمن

المسار `GET /metrics` غير مفعّل افتراضيًا. عند تفعيله في الإنتاج لا يقبل Session Cookie بدل الرمز التشغيلي. استخدم سرًا مستقلًا من مدير الأسرار، وقيّد عنوان الكاشط شبكيًا أو في Nginx/Apache متى أمكن.

```bash
export MCAP_METRICS_TOKEN='<read from secret manager>'
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${MCAP_METRICS_TOKEN}" \
  https://finance.example.com/metrics
unset MCAP_METRICS_TOKEN
```

لا تضع الرمز حرفيًا في سجل الطرفية أو URL. المخرج لا يحتوي `companyId` أو `requestId` أو بريدًا أو Idempotency key أو payload ماليًا. التسميات محصورة في operation وclassification وrequest class وevent type مع تحويل أي قيمة غير آمنة إلى `OTHER`.

### القياسات الأساسية

- `mcap_db_transaction_duration_seconds`: Histogram لمدة كل محاولة حسب operation والنتيجة.
- `mcap_db_deadlock_total` و`mcap_db_lock_wait_timeout_total` و`mcap_transaction_write_conflict_total`.
- `mcap_transaction_retry_total` و`mcap_transaction_retry_exhausted_total`.
- `mcap_optimistic_conflict_total` من استجابات `VERSION_CONFLICT` العامة.
- `mcap_request_deadline_exceeded_total` و`mcap_http_client_disconnected_total`.
- `mcap_outbox_events` و`mcap_outbox_oldest_lag_seconds` و`mcap_outbox_delivery_lag_seconds`.
- `mcap_outbox_retry_total` و`mcap_outbox_dead_letter_total`.
- `mcap_operational_alert_active{alert="..."}` لحالة قواعد التنبيه المدمجة.
- `mcap_operational_alert_last_fired_timestamp_seconds{alert="..."}` يحفظ آخر وقت إطلاق لكل قاعدة حتى لا يفوت الكاشط الخارجي تنبيهًا قصيرًا انتهى قبل الكشط التالي.

## قواعد التنبيه القابلة للضبط

| المتغير | الافتراضي | القاعدة |
|---|---:|---|
| `ALERT_WINDOW_MS` | 300000 | نافذة النسب والعدادات |
| `ALERT_MIN_TRANSACTION_SAMPLES` | 20 | حد العينات قبل الحكم على نسب المعاملات |
| `ALERT_DEADLOCK_RATIO_THRESHOLD` | 0.05 | Deadlocks / transaction attempts |
| `ALERT_RETRY_EXHAUSTED_RATIO_THRESHOLD` | 0.02 | Retry exhausted / transaction attempts |
| `ALERT_REQUEST_DEADLINE_COUNT_THRESHOLD` | 5 | عدد Deadlines داخل النافذة |
| `ALERT_OUTBOX_LAG_MS_THRESHOLD` | 60000 | عمر أقدم حدث Pending/Processing |
| `ALERT_OUTBOX_DEAD_LETTER_COUNT_THRESHOLD` | 1 | Failed snapshot أو dead letters داخل النافذة |
| `ALERT_COOLDOWN_MS` | 300000 | مدة إعادة إصدار Log لتنبيه مستمر |

تُصدر الانتقالات Logs باسم `operational_alert_firing` و`operational_alert_resolved` دون بيانات حساسة. ويجب على منصة المراقبة أيضًا التنبيه على Gauge؛ السجل المدمج ليس بديلًا عن Prometheus/Alertmanager أو المنصة المعتمدة.

### مراقب الإنتاج في GitHub Actions

يشغّل `.github/workflows/production-metrics-monitor.yml` كشطًا خارجيًا كل ساعة من بيئة `production`. يتحقق أولًا من أن الطلب دون رمز يعيد `401`، ثم يستخدم `METRICS_BEARER_TOKEN` من أسرار البيئة ويصدر فشلًا وGitHub annotation عند وجود تنبيه نشط أو إطلاق حدث خلال آخر 65 دقيقة. لا يُطبع الرمز ولا يُحفظ في Artifact، وتبقى المراقبة خارج عملية Passenger نفسها.

يتيح `workflow_dispatch` إدخال `test_alert=true`. بعد نجاح الكشط الفعلي يصدر هذا الخيار تنبيهًا تركيبيًا متعمدًا ويفشل التشغيل، لإثبات وصول قناة التنبيه دون حقن خطأ في قاعدة الإنتاج. شغّل الاختبار مرة عند التفعيل، ووثّق رابط التشغيل الفاشل المقصود، ثم شغّل مراقبة يدوية عادية ناجحة. إذا توقفت GitHub Actions بسبب الحصة أو عطل المنصة، تعامل مع غياب التشغيل الدوري كعطل مراقبة ولا تعتبر سجلات Passenger بديلًا دائمًا.

## الاستجابة للحوادث

### ارتفاع Deadlock أو Retry exhaustion

1. اربط وقت التنبيه بنشر أو Job أو نوع operation، من دون البحث بواسطة payload.
2. راجع ترتيب الأقفال ومدة المعاملة وعدد الاتصالات وslow query log.
3. لا ترفع `maxAttempts` أو timeout تلقائيًا؛ قد يزيد ذلك الضغط والتعارض.
4. أوقف أو خفّض حمل المسار المتسبب، ثم أعد اختبار سيناريوهات post-vs-close وreverse-vs-settlement على المحرك نفسه.

### ارتفاع Request deadlines

1. قارن Histogram HTTP وDB مع readiness واستخدام Pool.
2. تحقق من توافق مهلة Nginx/Passenger وعدم وجود حد خارجي أقصر.
3. افحص هل العميل يعيد `Idempotency-Key` نفسه بعد 504.
4. لا تحول 504 إلى نجاح ولا تبدأ Retry غير محدود في العميل.

### Outbox lag أو dead letter

1. افحص `mcap_outbox_events` حسب status و`outbox_health_snapshot`.
2. عالج المزود أو Handler أولًا؛ لا تعدّل payload أو lock token يدويًا.
3. للرسائل النهائية FAILED استخدم رحلة إعادة الإرسال في المجال بعد الإصلاح، وفق دليل التشغيل، بدل إعادة كتابة الصف.

## التحقق قبل النشر

- اختبارات الوحدة تثبت deadline المطلق، إلغاء backoff، قمع النجاح المتأخر، وحماية metrics.
- `operational-load.integration.test.ts` يشغل 16 معاملة مقاسة متزامنة بحدود واضحة ومن دون كتابة بيانات، ويعمل ضمن بوابتي MariaDB وMySQL عند `RUN_DB_TESTS=true`.
- اختبارات المجالات الفعلية تبقى المرجع لسلامة post-vs-close والتسويات المتزامنة والـIdempotency.
- عاير Baselines بعد جمع قياسات إنتاجية ممثلة؛ لا تعتبر القيم الافتراضية أهداف SLO نهائية.
