---
title: "Concurrency, Deadlock and Deadline Policy"
status: "mandatory"
version: "1.0"
last_updated: "2026-08-21"
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "ADR-003-domain-boundaries-and-eventing.md"
  - "CHANGE_REVIEW_CHECKLIST_AR.md"
---

# سياسة الـConcurrency والـDeadlock والـDeadlines

## 1. الهدف

تحدد هذه الوثيقة قواعد التزامن والأقفال وإعادة المحاولة والمهل الزمنية لجميع العمليات الحساسة، خصوصًا:

- الترحيل والعكس.
- إغلاق وإعادة فتح الفترات.
- حجز أرقام المستندات.
- تخصيص المقبوضات والمدفوعات للذمم.
- إنشاء الشركات والتسجيل المتزامن.
- Outbox workers مستقبلًا.

## 2. تعريفات

- **Concurrency:** تنفيذ عمليتين أو أكثر على بيانات مشتركة في الوقت نفسه.
- **Race condition:** اعتماد النتيجة على ترتيب التنفيذ بطريقة تكسر قاعدة أعمال.
- **Deadlock:** تمسك معاملتان بأقفال تحتاجها الأخرى، فتختار قاعدة البيانات إلغاء إحداهما.
- **Lock-wait timeout:** انتظار القفل تجاوز الحد المسموح، دون أن يكون بالضرورة deadlock.
- **Timeout:** مدة قصوى محلية لعملية أو طبقة.
- **Deadline:** وقت نهائي للعملية كاملة؛ جميع المحاولات والاتصالات يجب أن تنتهي قبله.
- **Optimistic concurrency:** كشف التغيير المتزامن عبر `version` أو شرط update بدل قفل طويل.
- **Pessimistic lock:** قفل صف صريح عند الحاجة إلى حماية قرار مبني على حالته الحالية.

## 3. تقييم الوضع الحالي

### نقاط قوة موجودة

- استخدام `version` في المستندات والفترات.
- Idempotency دائم للعمليات الحساسة.
- معاملات Serializable في عدة أوامر مالية.
- حجز ذري لأرقام المستندات باستخدام تحديث قاعدة البيانات.
- Retry محدود لبعض deadlocks في المدفوعات وحجز التسلسل.
- اختبارات تزامن للتسجيل وIdempotency وبعض حالات التكرار.
- Timeouts واضحة للـreadiness والإغلاق والبريد والتسجيل/التجهيز.

### فجوات يجب إصلاحها

- Retry classification والتنفيذ مكرران بين الخدمات.
- بعض أوامر الترحيل عند `P2034` تنتظر ظهور Idempotency record مكتملة، لكنها لا تعيد تنفيذ المعاملة إذا كان الخطأ deadlock مستقلًا؛ قد تنتهي بـ`IDEMPOTENCY_IN_PROGRESS` رغم عدم وجود عملية ناجحة.
- `P2002` يستخدم أحيانًا في مسار واحد مع `P2034` رغم أن unique conflict ليس deadlock؛ يجب تمييز سباق Idempotency عن تعارض أعمال آخر.
- Backoff الحالي خطي وقصير ومن دون jitter، ما قد يعيد ضغط العمليات المتعارضة في اللحظة نفسها.
- معظم المعاملات المالية لا تحدد `maxWait` و`timeout` صراحة.
- لا يوجد end-to-end request deadline موحد أو ضبط صريح لـHTTP server timeouts.
- لا توجد سياسة أقفال موحدة ومعلنة بين posting وperiod close وsettlements.
- تغطية اختبارات التزامن غير مكتملة للترحيل مقابل الإغلاق، والتسويات المتزامنة، والعكس مقابل التسوية.
- لا توجد metrics موحدة للـdeadlocks والـlock waits وretry exhaustion.

أدلة الوضع الحالي:

- `apps/api/src/payments/payment-service.ts:32-47`
- `apps/api/src/fiscal/fiscal-service.ts:191-222`
- `apps/api/src/journals/manual-journal-service.ts:808-834`
- `apps/api/src/receipts/receipt-service.ts:841-872`
- `apps/api/src/sales/sales-invoice-service.ts:637-647`
- `apps/api/src/purchases/purchase-invoice-service.ts:643-653`
- `apps/api/src/registration/registration-service.ts:96-270`
- `apps/api/src/config.ts:24-25`

## 4. المبادئ الحاكمة

1. **المنع أولًا، ثم Retry:** ترتيب الأقفال وقصر المعاملة أهم من إعادة المحاولة.
2. **Retry آمن فقط:** لا تعاد عملية كتابة إلا إذا كانت idempotent أو محمية بمفتاح Idempotency صالح.
3. **كل المحاولات ضمن Deadline واحد:** لا يبدأ Retry جديد إذا لم يتبق وقت يكفي لإتمامه.
4. **Business conflict ليس transient failure:** `VERSION_CONFLICT`, `PERIOD_CLOSED`, و`IDEMPOTENCY_MISMATCH` لا يعاد تنفيذها تلقائيًا.
5. **لا انتظار أو اتصال خارجي داخل المعاملة:** البريد وHTTP والملفات الثقيلة خارج transaction.
6. **أقل Isolation يكفي بأدلة:** لا يخفض أو يرفع isolation عشوائيًا؛ القرار يعتمد على invariant واختبارات التزامن.
7. **الأقفال بالترتيب نفسه في كل المسارات:** اختلاف الترتيب مصدر deadlock حتى لو كانت كل معاملة صحيحة منفردة.

## 5. سياسة الـDeadlock Retry

### 5.1 الأخطاء القابلة لإعادة المحاولة

يسمح بإعادة المعاملة كاملة فقط عند تصنيف مركزي موثق، ويشمل مبدئيًا:

- Prisma `P2034` عندما يمثل write conflict أو deadlock.
- خطأ MySQL/MariaDB رقم `1213` عند ظهوره عبر raw-query wrapper.
- Lock-wait timeout رقم `1205` فقط إذا كانت العملية idempotent، وما زال الـdeadline يسمح، وبعد التحقق من عدم وجود مشكلة تشغيلية مستمرة.

أي رمز آخر لا يضاف إلى القائمة إلا باختبار وقرار موثق.

### 5.2 أخطاء لا تعد Deadlock Retry

- `P2002` تعارض uniqueness: يعالج حسب invariant؛ سباق Idempotency يفحص السجل، بينما duplicate business key يعيد Conflict.
- `VERSION_CONFLICT`: يعاد للعميل كـ409.
- `IDEMPOTENCY_MISMATCH`: يرفض ولا يعاد.
- Validation وRBAC وcompany isolation failures.
- Period closed أو invalid state.

### 5.3 خوارزمية موحدة

يجب وجود `TransactionExecutor` أو مكون Infrastructure مكافئ، بدل نسخ حلقات retry في الخدمات.

السياسة الابتدائية المقترحة:

- حد أقصى 3 محاولات إجمالية للطلب التفاعلي، ما لم تثبت اختبارات الحمل حاجة مختلفة.
- Exponential backoff مع full jitter، مثل نافذة تقريبية 25ms ثم 50ms ثم 100ms.
- حساب الوقت المتبقي قبل كل محاولة.
- عدم Retry بعد تجاوز deadline أو إلغاء العميل.
- إعادة المعاملة كاملة من بدايتها، لا متابعة Transaction فاشلة.
- قراءة Idempotency result بعد unique race، لا اعتبار كل deadlock عملية قيد التنفيذ.
- تسجيل محاولة واحدة structured log دون payload حساس.

الأرقام Baseline وليست SLA نهائية؛ تضبط لاحقًا بقياسات الإنتاج واختبارات الحمل، ويحتاج تغييرها توثيقًا.

## 6. ترتيب الأقفال الإلزامي

عند احتياج العملية إلى أكثر من مورد، يكون الترتيب المستهدف:

1. Idempotency scope/record.
2. Company/Fiscal Period row عند ارتباط العملية بفترة.
3. Source aggregate أو `AccountingDocument`.
4. Document Sequence row عند حجز رقم داخل المعاملة.
5. Receivable/Payable settlement targets بترتيب المعرف تصاعديًا.
6. Accounts/Cost Centers/Currencies المطلوبة بترتيب ثابت عند الحاجة لقفلها.
7. Journal/Balance rows بترتيب `(accountId, fiscalPeriodStart, fiscalPeriodId)` أو الترتيب المعتمد في Posting Engine.
8. Audit وOutbox inserts في النهاية.

قواعد إضافية:

- عند قفل عدة معرفات من النوع نفسه، ترتب تصاعديًا قبل أي Query.
- يمنع مسار آخر من استخدام ترتيب عكسي.
- يجب أن يستخدم Period Close نفس قفل الفترة الذي يستخدمه Posting قبل فحص المستندات.
- يجب أن يتنافس Reverse وSettlement على مورد مجال مشترك يمنع النتيجتين غير المتوافقتين.
- `findUnique` العادي لا يعتبر وعدًا بقفل صف؛ عند الحاجة إلى قفل صريح يستخدم Adapter موثق واختبارات على MySQL/MariaDB.

قد يتغير الترتيب التفصيلي عند تنفيذ Posting Engine، لكن يجب أن يبقى ترتيبًا عالميًا واحدًا موثقًا ومختبرًا.

## 7. سياسة الـOptimistic Concurrency

- كل Aggregate قابل للتعديل يحمل `version` أو token مكافئًا.
- التغيير يستخدم conditional update يشمل `id`, `companyId`, الحالة، و`version` عند الصلة.
- نجاح `updateMany.count !== 1` يعني Conflict، لا Not Found تلقائيًا.
- API يعيد النسخة الجديدة بعد نجاح التغيير.
- لا يعاد تطبيق update من Payload قديم تلقائيًا.
- المسارات المتنافسة مثل post/cancel/update/reverse يجب أن تستخدم token واحدًا حاكمًا.

## 8. سياسة الـDeadlines والـTimeouts

### 8.1 هرم الميزانية الزمنية

```text
Reverse proxy deadline
    > HTTP server/request deadline
        > Application command deadline
            > DB transaction timeout + maxWait
                > single external call timeout
```

كل طبقة داخلية يجب أن تنتهي قبل الطبقة الخارجية مع هامش لإرجاع استجابة آمنة وتسجيل النتيجة.

### 8.2 Baselines مقترحة للتنفيذ والقياس

| العملية | Baseline أولي |
|---|---:|
| API read عادي | 10 ثوانٍ |
| API write/financial command | 15 ثانية |
| DB transaction مالية | 8 ثوانٍ، و`maxWait` ثانيتان |
| Registration provisioning | حتى 45 ثانية كما هو حاليًا، مع request budget أكبر |
| External email call | 10 ثوانٍ كما هو حاليًا |
| Readiness | 3 ثوانٍ كما هو حاليًا |
| Graceful shutdown | 10 ثوانٍ كما هو حاليًا |
| Outbox handler مستقبلًا | حسب النوع، وبحد صريح لكل محاولة |

هذه القيم نقطة بدء فقط. لا تعتبر SLA قبل اختبارات الحمل والقياس في بيئة الإنتاج.

### 8.3 قواعد التنفيذ

- يجب إضافة request deadline صريح بدل الاعتماد فقط على defaults.
- يجب ضبط `requestTimeout`, `headersTimeout`, و`keepAliveTimeout` بما يتوافق مع Nginx/الاستضافة.
- يجب تمرير `deadlineAt` أو `AbortSignal` داخل Request/Application Context عند دعم المسار لذلك.
- انتهاء Promise race لا يعني أن Query في قاعدة البيانات أُلغي؛ يجب استخدام transaction timeout/driver capabilities وعدم بدء عمل جديد بعد deadline.
- إذا أغلق العميل الاتصال، يوقف التطبيق بدء خطوات جديدة متى كان ذلك آمنًا، لكن لا يترك معاملة في حالة جزئية.
- كل Retry يستهلك من نفس الميزانية؛ لا يعيد ضبط الساعة.
- لا يرسل HTTP response نجاحًا بعد انتهاء deadline.

## 9. اختيار Isolation Level

- يبقى السلوك الحالي للعمليات المالية الحساسة حتى تنفيذ سياسة أقفال مركزية واختبارات حمل.
- `Serializable` ليس بديلًا عن ترتيب الأقفال وقد يزيد التعارض تحت الضغط.
- `ReadCommitted` مناسب لبعض العمليات الذرية المعزولة مثل sequence reservation إذا كانت SQL operation نفسها ذرية ومختبرة.
- تغيير isolation لأي use case يحتاج:
  - تحديد invariant.
  - اختبار منافسة واقعي على MySQL وMariaDB المدعومين.
  - قياس deadlocks/latency.
  - توثيق القرار في الكود أو ADR إذا كان واسع الأثر.

## 10. مصفوفة اختبارات التزامن الإلزامية

| السيناريو | النتيجة المطلوبة |
|---|---|
| نفس Idempotency key ونفس payload | أثر واحد واستجابة نجاح قابلة للإعادة |
| نفس المفتاح وpayload مختلف | رفض `IDEMPOTENCY_MISMATCH` |
| مفتاحان مختلفان لترحيل المستند نفسه | نجاح واحد فقط وقيد واحد |
| update مقابل post/cancel | عملية واحدة تحسم النسخة، والأخرى Conflict |
| post مقابل period close | لا يوجد مستند مرحل داخل فترة أغلقت بصورة غير متسقة |
| reverse مقابل receipt/payment allocation | لا يجتمع عكس غير مسموح مع تسوية ناجحة |
| قبضان على Outstanding غير كافٍ | مجموع التخصيص لا يتجاوز الذمة |
| دفعان على Payable Outstanding غير كافٍ | مجموع التخصيص لا يتجاوز الذمة |
| حجز 20 رقم مستند بالتوازي | لا تكرار؛ يسمح بالفجوات عند rollback حسب السياسة |
| تسجيل/تجهيز متزامن | Tenant/User واحد ونتيجة قابلة للإعادة |
| Retry بعد deadlock مصطنع | نجاح آمن أو خطأ exhausted واضح دون أثر مكرر |
| انتهاء deadline أثناء الانتظار | rollback/توقف آمن وخطأ معياري |
| Outbox delivery مكرر مستقبلًا | handler idempotent وأثر واحد |
| عمليات شركات مختلفة | لا قفل أو تسرب غير ضروري بين الشركات |

يجب تنفيذ اختبارات قاعدة البيانات على MySQL 8.4 وMariaDB 10.11 لمسارات الأقفال والـdeadlocks الحرجة، لأن السلوك والتشخيص قد يختلفان عن الاختبارات الوهمية.

## 11. الرصد والتشخيص

يجب قياس وتسجيل ما يلي دون بيانات حساسة:

- `db_transaction_duration` حسب operation.
- `db_deadlock_total`.
- `db_lock_wait_timeout_total`.
- `transaction_retry_total` وattempt number.
- `transaction_retry_exhausted_total`.
- `optimistic_conflict_total`.
- `request_deadline_exceeded_total`.
- Outbox lag/retry/dead-letter مستقبلًا.

السجل يتضمن operation، company scope عند توفره، request/correlation reference، attempt، elapsed time، والتصنيف النهائي. لا يسجل Idempotency key الخام أو payload مالي حساس.

تنبيه تشغيلي مطلوب عند ارتفاع نسبة deadlock أو retry exhaustion، وليس عند حادثة منفردة فقط.

## 12. الأخطاء المعيارية المقترحة

| الحالة | الاستجابة المقترحة |
|---|---|
| Optimistic version conflict | HTTP 409 مع `VERSION_CONFLICT` |
| Idempotency payload mismatch | HTTP 409 مع `IDEMPOTENCY_MISMATCH` |
| نفس العملية ما زالت تنفذ فعليًا | HTTP 409 مع `IDEMPOTENCY_IN_PROGRESS` |
| Retryable transaction failure بعد استنفاد المحاولات | HTTP 503 مع `CONCURRENCY_RETRY_EXHAUSTED` |
| Request/application deadline exceeded | HTTP 504 مع `REQUEST_DEADLINE_EXCEEDED` |
| Client disconnected | إيقاف آمن وتسجيل داخلي دون محاولة إرسال response |

لا تظهر أكواد Prisma أو MySQL الخام للعميل.

## 13. خطة التطبيق

### P0

1. إنشاء classifier مركزي للأخطاء القابلة لإعادة المحاولة.
2. إنشاء `TransactionExecutor` موحد بdeadline وbackoff+jitter.
3. فصل سباق Idempotency `P2002` عن deadlock `P2034/1213`.
4. توثيق وتنفيذ lock order داخل Posting Engine وPeriod Close.
5. إضافة اختبارات post-vs-close وsettlement-vs-reverse وover-allocation المتزامن.

### P1

1. تحديد transaction `maxWait/timeout` لكل فئة عملية.
2. إضافة HTTP/request deadlines متوافقة مع Nginx.
3. إضافة metrics وتنبيهات للـdeadlocks والـretry exhaustion.
4. نقل حلقات retry المكررة إلى Infrastructure واحدة.

### P2

1. اختبارات حمل ومعايرة baselines.
2. مراجعة Isolation Levels بأدلة القياس.
3. تطبيق السياسة على Outbox workers والتقارير الخلفية.

## 14. قواعد ممنوعة

- يمنع Retry غير محدود.
- يمنع Retry فوري متطابق من جميع العمال دون jitter.
- يمنع Retry لأخطاء Business أو Authorization.
- يمنع بدء محاولة بعد deadline.
- يمنع النوم داخل transaction.
- يمنع استدعاء API أو بريد داخل transaction.
- يمنع قفل مجموعة صفوف بترتيب غير ثابت.
- يمنع ابتلاع deadlock وإرجاع نجاح.
- يمنع تحويل كل conflict إلى HTTP 500.
- يمنع اعتبار Idempotency بديلًا عن locking/version أو العكس.
