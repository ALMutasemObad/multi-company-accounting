# تكامل العروض والمصادقة واستهلاك الاشتراك — 2026-08-31

الحالة: تنفيذ محلي على `feat/public-subscription-plans` في
`project-public-subscription-plans`. لا Push أو PR أو Merge إلى main أو نشر.
اكتمل التكامل والتحقق المحلي؛ لا تعد هذه الوثيقة تصريح إصدار قبل بوابتي DB.
الشيفرة المختبرة عند `bfdc1d1a4c37d88e6ba1ed1e412abd4a05bf11f5`؛ يليها توثيق
النتائج فقط. استُخدم Node24.19 محليًا؛ بوابات CI تختبر Node22 المثبت أيضًا.

## ما جُمع فعليًا

| المسار | الالتزامات الأصلية بالترتيب | نسخها في التكامل |
|---|---|---|
| B — المصادقة | f8c4011، be66071، c934945 | 4bfd7e3، 862b748، a318498 |
| A — العروض العامة | 130704d، 82fb93f، 66e9987، 751ebeb | a3dd40d، 6cb168a، 781d0d2، 971557b |
| C — الاستهلاك | 0fb4f8a، 1d4b38a، 4cce689، 35cda99، 61c9782 | 8fb9cd0، 9633d6f، fb521ba، 5613712، 349f172 |

لا يُجمع `dda02aa` من C؛ العقد المركزي `b8dc7a1` موجود أصلًا. تسليمات المهام
في `TRACK_A_PUBLIC_OFFERS_HANDOFF_AR.md` و`TRACK_B_AUTH_RESILIENCE_HANDOFF_AR.md`
و`TRACK_C_SUBSCRIPTION_USAGE_HANDOFF_AR.md`. تبقى أرقامها أدلة مستقلة، لا بديلًا
عن اختبار الشيفرة المجمعة. لا تغيير لشجرة `project` المتسخة أو فروع المسارات.

## ربط المنسق وإغلاق الفجوات

- ربط `createSubscriptionUsageService(database, platformAnalytics)` في server،
  وRouter اختياري في app، باستخدام محول Analytics القائم عبر composition فقط.
- اختبارات التطبيق الفعلي تمر عبر createApp لا harness مصغر: استجابة200 مولدة
  ومحققة، no-store وrequestId،401/403 قبل منفذي القراءة،400 لمحاولة تغيير الشركة
  أو الفترة عبر query،404 للشركة المفقودة،500 من المعالج الحقيقي دون تسريب،
  و503/504 لعقود الأخطاء المؤقتة. اختبار429 يستعمل محدد الجلسة الحقيقي، ويتحقق
  من Retry-After وعدم استدعاء التفويض أو البيانات بعد استنفاد الحد.
- أدلة503/504 تختبر تمرير خطأ مصنف من المنفذ إلى المعالج، وليست تجربة deadlock
  حقيقية على قاعدة بيانات. اختبار المحدد محلي in-process وليس اختبار توزيع حمل.
- أضيف رد استهلاك اصطناعي إلى mock الواجهة، بفترة إحصائية وحصة مستندات بلا
  باقي/تجاوز ومعرف يطابق النشاط المحدد في auth/me. كشفت الجولة الأولى اختلاف
  معرف company العام في fixture عن selectedCompany؛ رفضت اللوحة الاستجابة
  كما يجب. أوقف المنسق جولته بعد55 حالة، أصلح mock وأضاف assertion للمطابقة؛
  لا تغيير لحماية العزل في الشيفرة. تبقى أدلة الجولة الموقوفة تحت
  `test-results/coordinator-integration-ui/` ولا تعد نجاحًا.
- اختبار public-plans القديم لم يعد يقبل الاستبدال الصامت إلى2101: يجب فراغ
  الاختيار والتنبيه وتعطيل الإرسال؛ يصبح الاختيار ممكنًا بقرار المستخدم فقط.
- عند الجمع فشل اختبار C لأنه توقع DOM AbortError قبل توحيد الأخطاء في B.
  صُحح التوقع إلى RequestError(kind=cancelled)، مع تحقق إضافي من إلغاء signal
  النقل وعدم تكرار fetch. لم تُغيّر آلية الإلغاء أو تُخفف مهلة القراءة.
- اختبار الرحلة المتصلة يبدأ عامًا دون CSRF، ثم اختيار باقة وتسجيل ودخول،
  ثم انتقال تلقائي إلى صفحة الاشتراك مع حفظ التفضيل وتحميل/تحديث الاستهلاك.
  يؤكد أن الكتابتين الوحيدتين هما طلب التسجيل والدخول؛ لا طلب تغيير باقة أو
  checkout ضمني. البريد وإنشاء النشاط الفعليان خارج fixtures؛ يغطيهما DB E2E.
- إعداد تكامل معزول على3133/4183 وworker واحد وretries=0 وtrace/video معطلة؛
  اختبارات الواجهة العامة والأساس على390/768/1440/1920، وB/C على390/1440.

## النتائج المركزية

| البوابة | النتيجة |
|---|---|
| TypeScript API المصدر والاختبارات، Web، E2E، track-b، integration | ناجح |
| API المركز: usage/app/contract/route parity | 53 ناجحًا |
| API الكامل بعد الربط | 523 ناجحًا،136 اختبار DB متجاوزًا،صفر فشل |
| Web الكامل بعد تحديث توقع الإلغاء | 116 ناجحًا؛ الجولة السابقة115 ناجحًا/فشل التوقع المذكور فقط |
| Infra | 55 ناجحًا،صفر فشل؛ أصلح حارس الاسم القديم في وثيقة التنسيق دون استثناء |
| OpenAPI generated check | ناجح؛167 جسم طلب و2101 جسم استجابة |
| Redocly2.46.2 المقفل المتاح offline | ناجح |
| i18n/UI | ناجح |
| بناء API وWeb | ناجح |
| متصفح التكامل النهائي | 260/260 ناجحًا،صفر فشل،صفر retry،13.3دقيقة |
| MariaDB10.11 وMySQL8.4 fresh + upgrade + DB E2E | لم تُشغّل؛ مانع دمج |

تقرير API المحلي: `test-results/coordinator-integrated-api.json`؛659 حالة إجمالًا
تشمل136 skipped، لا659 نجاحًا. الصور المركزية تحت
`test-results/coordinator-integration-final/`، ولا تضم إلى Git.
ملف `.last-run.json` النهائي يحمل `status=passed` و`failedTests=[]`.
سبقت الجولة النهائية إعادة مركزة ناجحة3/3 بالعربية على الهاتف بعد إصلاح fixture.
راجع المنسق صور الرحلة والاستهلاك على الهاتف والمقارنة على الهاتف والكمبيوتر،
ومراجعة إعلان المشغل. صور عناصر طويلة قد تتضمن الشريط المثبت أثناء الالتقاط؛
اختبارات الاحتواء والتمرير مستقلة، وهذه صور مكونات لا قوالب طباعة.

سجل C التاريخي22/22 يسبق تعديل مقاس CSS الأخير، ثم2/2 عربية بعده؛ لا تُعاد
نسبة22 للنسخة اللاحقة، والصورتان العربيتان فقط بقيتا في مجلد C بعد الجولة
المركزة. جولة المنسق مستقلة وتفحص CSS النهائي على شيفرة التكامل.

## حدود الإصدار والأداء

- لا بوابة DB مدعومة محلية: `mysqld --version` في XAMPP يعطي10.4.32-MariaDB؛
  لا يُستخدم بدل10.11 أو MySQL8.4. Docker/mysql/mariadb غير متاحة على PATH.
  لا تنزيل محرك أو تغيير استضافة أو تشغيل migration على بيانات منشورة.
- بقي نحو2GiB حرًا عند بدء الجولة المركزية. لا install أو Prisma generate أو
  حذف ملفات مستخدم أو إيقاف عمليات الآخرين؛ اعتمدت التبعيات المقفلة الموجودة.
- تبقى حادثة بطءTCP/TLS على الاستضافة مفتوحة؛ تحسين مهلة الواجهة والإلغاء
  والرسائل لا يثبت إصلاح الشبكة أو الخادم. لا اختبار حمل ممثل أو SLO معاير.
- قياس الاستهلاك count/إسقاط محدود الذاكرة، لكنه ليس ثابت زمن التنفيذ، ويعيد
  الاستخدام الحالي count رابعًا للعمليات غير المعروضة؛ لا benchmark DB كبيرة.
- B لا يكررPOST تلقائيًا؛ ضياع body نجاح login لا يُستعاد معه CSRF المصادق عليه
  عبر PRE_AUTH. التعافي دون إعادة كلمة المرور يخص نجاح login الكامل فقط.
- المستندات شهرUTC إحصائي، لا دورة فوترة مؤكدة، ولا رسوم/حظر/حصص مضروبة بحسب
  دورة الخطة. BEST_EFFORT لا يدعي لقطةACID. null غير مهيأ/معروف، لا غير محدود.
- لا تعديلLedger أو كتابةعابرةللسياقات أو حسابمالي بـNumber أو حدث/Outbox جديد.
  صلاحيةsubscriptions.view وعزل النشاط في الخادم؛ فحوص الواجهة ليست إنفاذًا بديلًا.
- Barcode Impact: غير منطبق؛ لا إدخال صنف أو مستند بنود أو طباعة/تصدير/ملصق
  جديد. بقيت حواجز الباركود القائمة ضمن اختباراتInfra الناجحة.
- بعض العناوين المشتركة القديمة للاشتراكات تظهر بالإنجليزية في الهندية؛ النصوص
  الجديدة للمسارات مترجمة. الدين مسجل دون توسيع نطاق هذا التكامل عشوائيًا.

لا تُنقل نتائجmain السابقة لهذه الدفعة. يلزم تشغيل بوابتي المحركين على نفس
commit النهائي، ثم موافقة منفصلة قبل main أو النشر وفق نطاق التفويض اللاحق.

## أوامر إعادة التحقق

من جذر نسخة التكامل، بعد ضبط Node/npm كما في وثيقة التنسيق:

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.test.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.e2e.json
node node_modules/typescript/bin/tsc -p tsconfig.track-b.json
node node_modules/typescript/bin/tsc -p tsconfig.integration.json
node node_modules/vitest/vitest.mjs run --root apps/api --maxWorkers=1 --reporter=json --outputFile=../../test-results/coordinator-integrated-api.json
node node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
node scripts/generate-openapi-guards.mjs --check
node scripts/check-web-i18n.mjs
node scripts/check-web-ui.mjs
node --test scripts/tests/*.test.mjs
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node node_modules/vite/bin/vite.js build apps/web
npm exec --offline --yes --package=@redocly/cli@2.46.2 -- redocly lint packages/contracts/openapi.yaml
node node_modules/@playwright/test/cli.js test --config playwright.integration.config.ts
```
