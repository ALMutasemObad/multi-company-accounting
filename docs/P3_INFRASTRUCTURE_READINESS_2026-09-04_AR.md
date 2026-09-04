# خطة جاهزية البنية P3

التاريخ: 4 سبتمبر 2026. بدأ المسار من المرشح المثبت
`b117636c1b353a28997c2f83294657fc926fa1fc` على
`integration/owner-demo-20260904`، ويعمل في Worktree مستقل على
`p3/infra-readiness-20260904`. هذه خطة حماية للإصدار المرئي الحالي، لا توسعة منتج
ولا إذن Push أو PR أو Merge أو Deploy.

## الحالة المثبتة الآن

- أنشئ Worktree مستقل من الالتزام المحدد. لم تتغير قاعدة بيانات أو بيئة مستضافة.
- بوابة الجهاز الحالي لا تملك Docker أو Podman أو خدمة/عميل MySQL/MariaDB، وWSL
  موجود بلا توزيعة. لذلك لم تُشغّل بوابتا قاعدة البيانات محليًا ولم يُدّع نجاحهما.
- رقّع القفل فقط: `fast-uri 3.1.5→3.1.7` و`qs 6.15.3→6.16.0`.
  شجرة الإنتاج المنقاة أصبحت بلا تنبيهات؛ تفاصيل `mysql2` المؤجلة في
  [سياسة الاعتماديات](security-advisories.md).
- البيانات العامة لـGitHub تثبت أن `main` محمي وأن المطلوب حاليًا هما
  `iFastNet compatibility (Node 22 / MariaDB 10.11)` و`verify` فقط. لا يظهر
  اختبارا upgrade للمحركين ضمن required contexts. فحص التفاصيل الكاملة أعاد 401
  لغياب مصادقة GitHub، لذلك لا يوجد دليل محلي على عدد الموافقات أو منع force-push
  والحذف أو تقييد المسؤولين.
- أي Push مدمج إلى `main` يشغّل نشر Staging تلقائيًا بعد البوابات. لذلك موافقة
  الدمج هي أيضًا قرار نشر Staging، ولا تنفذ ضمن هذا المسار.

الدليل المحلي على Node 24.19.0:

| البوابة | النتيجة |
|---|---|
| TypeScript وOpenAPI وi18n وUI والبناء | ناجحة؛ 170 جسم طلب و2199 جسم استجابة، و28 header و67 table region |
| اختبارات API وWeb | API: ‏1200 ناجحة و157 متجاوزة لغياب DB؛ Web: ‏653/653 |
| اختبارات Infra | 324 ناجحة، وتجاوز Windows اختبارًا واحدًا يحتاج دلالات path/socket أصلية في Linux وسيعمل في CI |
| عرض المنتج | 4/4 ناجحة عند 390px و1440px بالعربية والإنجليزية؛ 4 تجاوزات مقصودة للمقاسات غير المرجعية |
| قبول الاشتراك | 58/58 ناجحة؛ billing recovery ‏40/40. الجولة الموسعة: 339 ناجحة و4 متجاوزة وتعثر Vite مؤقت واحد نجح منفردًا عند الإعادة |
| قاعدة البيانات | لم تشغّل بسبب غياب المحرك والعملاء المحليين؛ يلزم نجاح CI ولا يستبدله الدليل أعلاه |

## قبل العرض الداخلي — P0

| العمل | معيار القبول |
|---|---|
| تثبيت المرشح | العرض من SHA واحد موثق، و`git status --porcelain` فارغ بعد الاختبارات |
| حماية النتيجة المرئية | نجاح Web tests والبناء وvisual/product-showcase ولقطات 390px و1440px بلا تحديث snapshots غير معتمد |
| الاعتماديات | صفر High/Critical في `npm audit --omit=dev --omit=optional`، وكل تنبيه تطوير موثق بمساره وموعد إغلاقه |
| قاعدة العرض | إذا كان العرض متصلًا بقاعدة فعلية: نجاح fresh migrations وseed وAPI DB tests وE2E على MariaDB 10.11 أو MySQL 8.4 قبل العرض؛ وإلا يستخدم visual fixture المخصص فقط |
| قرار المالك | اعتماد صريح للـSHA ونوع العرض: fixture محلي أو قاعدة اختبار؛ لا يستعمل Staging أو بيانات إنتاج بلا تفويض منفصل |

أقصر عائق فعلي للبوابة الكاملة هو توفير محرك حاويات عامل. بعده يلزم Linux/WSL أو
Git Bash مع عميل `mysql/mysqldump` لأن سكربتات round-trip حتمية وآمنة بصيغة Bash.

## قبل الـPilot — P1

| العمل | معيار القبول |
|---|---|
| بوابتا البيانات | نجاح `hosting-compatibility` و`verify`، ثم fresh+upgrade على MariaDB 10.11.11 وMySQL 8.4.11، مع `migrate status` نظيف وAPI DB tests وDB E2E |
| النسخ والاستعادة | نجاح `database-identities.integration.sh` و`database-roundtrip.sh` إلى قاعدة فارغة لكل محرك؛ لا أسرار أو بيانات حقيقية في fixtures |
| حماية `main` | إضافة نتيجتي upgrade للمحركين، أو aggregator ثابت يغطيهما، إلى required checks. يتحقق المالك كذلك من PR review واحد على الأقل، dismiss stale approvals، منع force-push والحذف، وتطبيق القواعد على المسؤولين حسب صلاحيات الخطة |
| قياس متعدد الشركات | fixture معزول قابل للإعادة لاثنتي عشرة شركة: أربع صغيرة وأربع متوسطة وأربع كبيرة، مع نافذة UTC موحدة وحجوم users/employees/documents موثقة. صفر تسرب أو خلط companyId وصفر اختلاف في العدادات |
| SLO مبدئي للقراءة | بعد warm-up، 3 جولات لكل شركة و50 قراءة لكل جولة بتزامن 4: نجاح 100%، صفر 429/503/504، وp95≤2s وp99≤5s لكل مسار اشتراك. تسجل CPU/RAM وDB acquire وSQL count ونسخة المحرك وإعداد Pool |
| أوامر مالية ممثلة | في حمل pilot المعتمد: صفر خرق invariant، صفر retry exhausted/deadline، وp95≤3s للأمر؛ لا تعتمد النسب قبل نجاح post-vs-close والتسويات المتزامنة على المحركين |

الأرقام السابقة بوابة Pilot مؤقتة لا SLA تجاري. لا يغيّر Pool أو Isolation Level إلا
بمقارنة قبل/بعد على البيانات والإعدادات نفسيهما، مع p50/p95/p99 وdeadlocks ووقت acquire
وCPU/IO. أداة `performance:subscription-reads` حد أمان صغير؛ تشغّل لكل جلسة شركة
على API محلي فقط، ولا توجه إلى loopback proxy أو Staging.

## قبل الإنتاج — P2

| العمل | معيار القبول |
|---|---|
| SLO نهائي وميزانية خطأ | اعتماد المالك لأهداف القراءة والكتابة والتوافر من قياس ممثل، ولوحات وتنبيه مجدول يثبت اكتشاف خرق تركيبي؛ لا تعتبر deadlines الحالية SLO |
| السعة والعزل | اختبار حمل متعدد الشركات على topology الإنتاج المتوقعة يثبت حدود Pool وعدد عمليات API وغياب تسرب الشركات، مع headroom موثق للترحيل والنسخ والإدارة |
| التعافي | نسخة مشفرة خارج الاستضافة كل ≤25.5 ساعة، تمرين استعادة ناجح كل ≤35 يومًا، وزمن الاستعادة التقنية ≤900 ثانية كما في البوابات الحالية؛ يسجل RPO/RTO الحادث الكامل منفصلًا |
| الإصدار | Artifact واحد قابل لإعادة البناء من SHA مع بصمات متطابقة، fresh/upgrade للمحركين، smoke وgraceful shutdown، وموافقة بشرية على Environment إنتاج منفصل |
| الأمن التشغيلي | أسرار في مدير مستقل، هوية runtime DML منفصلة عن migration، TLS/secure cookie/rate-limit fail-closed، وصفر High/Critical في شجرة الإنتاج |

## إعادة تشغيل بوابات قاعدة البيانات والتنظيف

يشغّل كل محرك في حاوية منفصلة وفارغة وبالصور المثبتة في `.github/workflows/ci.yml`:
`mariadb:10.11.11@sha256:96be0d3dfbeb07bc420e5fb8a6dc05c492676f1f89980a497a55e6fbbba3f1c4`
مع Node 22.23.2 وعميل MariaDB، و
`mysql:8.4.11@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb`
مع Node 24.19.0 وعميل MySQL. تنفذ لكل محرك
جولة fresh مستقلة وجولة upgrade مستقلة بهذا الترتيب:

```text
npm@12.0.2 ci → prisma:generate → contracts:check → database:verify-engine
→ prisma migrate deploy/status → prisma:seed + prisma:seed:demo
→ test:db → build → E2E_DISPOSABLE_DATABASE=test_mcap_finance npm run e2e
→ database-identities.integration.sh → database-roundtrip.sh
```

وجولة upgrade تستخدم حرفيًا
`PRODUCTION_BASELINE_COMMIT=c39b97949655f43c9fe35f98b3d47cce5c6c6054` و
`PRODUCTION_BASELINE_MIGRATION_COUNT=38` مع
`scripts/ci/database-upgrade-compatibility.sh`، ثم seed الحالي و`test:db`.
تعاد الجولة من Checkout نظيف للـSHA المرشح، ولا يعاد استخدام volume بين المحركين.

بعد اعتماد المالك ونجاح CI فقط: يدمج المرشح كاملًا في PR واحدة لأن فصل التزام P3
عن الالتزامات المرئية يختبر SHA مختلفًا. قبل أي تنظيف يتحقق أن التزام P3 ancestor من
`origin/main` وأن Worktree نظيف. بعدها فقط يستخدم `git worktree remove <path>` ثم
`git branch -d p3/infra-readiness-20260904`. يمنع `-D` والحذف اليدوي للمجلد و
`worktree prune` والحذف البعيد بلا قرار مستقل. لم ينفذ هذا المسار أي تنظيف الآن.
