# مرشح محلي — تكامل الجلسة والعملاء والمصروفات

التاريخ: 2026-09-06. المهمة `phase3-integration`، الفرع `task/phase3-integration`، الأساس المتحقق منه `9be397c7a435720c921425b6cb7b64e5dbab7ebc`. الالتزام النهائي يسجله MarkReady في سجل مساحة العمل. لا PR ولا CI بعيد ولا نشر لهذه الحزمة.

## المراجعة المستقلة والدمج المحلي

قُرئت تعليمات الجذر والمستودع، ونجح `Enter-Workspace.ps1` ثم `Workspace.ps1 -Action Check -Refresh`. جرى الانتقال صراحة إلى worktree المسجل بعد Enter. لم تُشغّل نسخة مؤرشفة ولم تُعدّل main.

راجعت نطاقات وتسليمات وفروق الالتزامات التالية قبل تطبيقها بالترتيب، دون تعارض:

| التسليم الأصلي | الالتزام المحلي الناتج |
|---|---|
| `ab2952d691b5b7472b09389b8c1db5af43f202ac` | `7a97c21` |
| `5e2d03bf24cad41334bcc24d7dea70958b2a6421` | `ced8da8` |
| `7dc0a7940fdc805ae08f6abb9475978bb2eaac3a` | `873d0fa` |

- حدود هوية الصفحتين وإزالة صفحة الشركة أثناء الاختيار تتكامل مع إلغاء جيل الطلبات في api؛ لا تغيير عقود أو قاعدة بيانات أو صلاحيات خادمية.
- تصنيف INVALID_CSRF يسبق تصنيف 401. لا إعادة إرسال تلقائية. تثبت الاختبارات بقاء المدخلات والمفتاح للمحاولة غير المعدلة داخل الصفحة فقط.
- راجعت عزل أخطاء ونتائج القراءات والكتابات القديمة، وقفل النقر المكرر، وصلاحيات الواجهة، ودقة عرض المبالغ النصية في CRM. اختبارات التسليمات تستمر في تغطية التأهيل والتحويل والمتابعة وفلاتر المصروفات.
- ملفات fixture تدخل فقط من صفحات HTML التجريبية. لا يستوردها entry الإنتاج، والبناء يستعمل index.html المعتاد. البحث في dist عن علامات fixtures والبيانات التجريبية لم يجدها؛ create-release ينقل `apps/web/dist` ولا ينقل `apps/web/src`. يبقى الأمر التشغيلي `crm-journey/command-sender.ts` مستوردًا عمدًا، وهو ليس fixture.
- لا تعديل لملف القفل أو الاعتماد أو ملفات مشتركة خارج النطاق. جرى تثبيت 359 حزمة محليًا بـnpm 12.0.2 من lock، دون نسخ node_modules أو Prisma. حزمة npm الرسمية نُزلت إلى TEMP وقورنت SHA512 مع dist.integrity قبل فكها.

## عيب التكامل ونتيجة الإصلاح

قبل الإصلاح: نجاح 680 اختبار وحدة، typecheck/build، و13 اختبار CRM و4 مصروفات وفحص الجلسة الأصلي لم يكشف اختلاف URL عن حالة App. اختبارات App الجديدة نجحت في أخطاء الحفظ وتبديل الشركة، وفشلت عند الرجوع إلى نفس hash بعد خروج المستخدم ودخول آخر: clearShell كان يعيد route إلى home بينما يبقى hash الصفحة السابقة؛ إسناد hash نفسه لا يطلق hashchange، فتبقى home بدل الرحلة.

الإصلاح الوحيد الإضافي في الإنتاج: نقل `replaceHash("login")` إلى clearShell المشترك، وإزالة تكراره من مستمع انتهاء الجلسة. أصبح الخروج والرجوع لشاشة الدخول وانتهاء الجلسة متسقًا مع URL. لا تخزين مسودات جديد ولا تعديل منطق أعمال.

بعد الإصلاح: أعيد full web فنجح 49 ملفًا / 680 اختبارًا، ثم typecheck/build بنجاح. نجحت مجموعة App الأولى 10/10، ثم المجموعة النهائية الموسعة 14/14 بعد إضافة الرجوع والتقدم. فشل إعداد أولي منفصل للاختبارات كان بسبب غياب مسؤول CRM المطلوب؛ أضيف للبيانات التجريبية. كما أن modal يحجب النقر على الشريط الجانبي، لذا يستدعي اختبار التبديل المتزامن مع كتابة معلقة معالج زر App عبر DOM click مباشرة؛ لا ندعي أن النقر بالمؤشر متاح خلف modal.

## الاختبارات الفعلية وحدود المحاكاة

`session-safety/integration.pw.mjs` يدخل index التطبيق الفعلي، ويستعمل App وموفري اللغة والصلاحيات والصفحتين وapi الحقيقيين في Chromium:

- لكل رحلة: فشل شبكة ثم INVALID_CSRF مع 403 ومع 401؛ تبقى المدخلات ويعاد استخدام مفتاح idempotency والجسم نفسيهما. يلي ذلك نجاح حفظ، ثم نموذج جديد، ثم 401 مصادقة حقيقي يؤدي إلى إزالة النموذج ورسالة انتهاء الجلسة ودخول مستخدم جديد بنموذج فارغ.
- لكل رحلة ولكل تبديل شركة أو مستخدم: GET متأخر بحالة 401 وPOST متأخر ناجح. النقل التجريبي يتلقى الرد ثم يؤخر تسليمه ويتعمد تجاهل AbortSignal؛ إطلاق الرد بعد تبديل الهوية لا يغلق الجلسة الجديدة ولا يمسح مسودتها ولا يعرض toast قديمًا. GET ينطلق من بحث/فلتر الصفحة، وPOST من نموذجها، لا من probe مستقل.
- أربع حالات إضافية: logout و401 لكل رحلة، ثم history back/forward وتغيير hash إلى صفحة محمية. تبقى شاشة الدخول، ولا يعود shell القديم؛ تبقى رسالة انتهاء الجلسة في حالات 401.
- فحص localStorage/sessionStorage لا يجد نص المسودة أو كلمة المرور التجريبية. لا يختبر جميع مخازن وصفحات النظام.

جميع HTTP في اختبارات المتصفح مُحاكى ومحصور محليًا. **ليس هذا اختبار backend أو cookies أو idempotency أو RBAC خادمي أو rollback.** إلغاء انتظار المتصفح لا يثبت إلغاء معاملة وصلت إلى الخادم. لم تتصل المهمة بقاعدة بيانات أو بيانات حية، ولم تُشغّل ترحيلًا أو Prisma generate.

## أوامر إعادة التشغيل والأدلة

من جذر worktree مع إضافة `C:/Users/motas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` إلى PATH للجلسة، Node v24.19.0 وnpm12.0.2:

```powershell
node "$env:TEMP/phase3-integration-npm-12.0.2/package/bin/npm-cli.js" ci --no-audit --no-fund
node node_modules/vitest/vitest.mjs run apps/web/src
node node_modules/typescript/bin/tsc -b apps/web --pretty false
node node_modules/vite/bin/vite.js build apps/web
node node_modules/@playwright/test/cli.js test --config apps/web/src/crm-journey/playwright.config.mjs
node node_modules/@playwright/test/cli.js test --config apps/web/src/expense-journey/playwright.config.mjs
node node_modules/@playwright/test/cli.js test --config apps/web/src/session-safety/playwright.config.mjs
# مع Vite محلي على 127.0.0.1:5197:
node apps/web/src/session-safety/browser-check.mjs
node scripts/check-web-i18n.mjs
node scripts/check-web-ui.mjs
node --test scripts/tests/brand-removal.test.mjs
git diff --check
```

النتائج: 680 وحدة، 13 CRM، 4 مصروفات، 14 App، وفحص الجلسة المستقل: نجاح. فحص الترجمة والواجهة والعلامة التجارية وwhitespace: نجاح. دليل التشغيل المحلي المتجاهل في `test-results/phase3-evidence`؛ الأدلة ليست CI. تحذير البناء الباقي: chunk employee-expenses نحو 545.47kB قبل gzip، خارج نطاق الإصلاح.

## مراجعة الاعتماد والنشر — قراءة فقط

`npm audit --json`: حزمتان متأثرتان، mysql2 عالي وprisma متوسط؛ صفر critical. `npm explain mysql2` يعرض mysql2@3.15.3 عبر prisma@7.9.1، المعرف dev في apps/api مع peerOptional من @prisma/client. التقرير يذكر [تخفيض آلية المصادقة](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) و[فك ضغط غير محدود](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3). لم أطبق الإصلاح المقترح لأنه major downgrade إلى Prisma6 وليس قرار مهمة واجهة.

الفصل الضروري بين البيئات:

- **Runtime artifact:** فحص `npm audit --omit=dev --omit=optional --json` يعيد صفر ثغرات. CI ينفذ prune بهذه الخيارات؛ create-release يرفض وجود prisma/tsx/typescript/vitest وينقل node_modules المقلم وdist. هذا دليل من التقرير والكود، وليس فحصًا لحزمة Linux منشأة أو لمضيف النشر الفعلي.
- **Build:** Prisma/mysql2 موجودان قبل prune. خطوة إعادة بناء Staging تحدد DATABASE_URL تجريبيًا على loopback وتنفذ generate ثم tsc/Vite؛ وفق الخطوات المقروءة لا تطلب اتصال قاعدة أثناء بناء الإصدار. لم أراقب شبكة أدوات البناء ولم أزعم انعدام كل سلوك شبكة. إعداد prisma.config يقرأ DATABASE_URL وdotenv فقط.
- **CI:** مراحل التحقق الأخرى تنفذ migrate deploy/status وseed مقابل MySQL الاختبار المحلي، وهي اتصال قاعدة فعلي مختلف عن خطوة البناء. صفر runtime audit لا يغطي هذه الأدوات.
- **Migration deployment:** `deploy/scripts/install-cpanel-release.sh` ينفذ `npx prisma@7.9.1 migrate deploy` مع MIGRATION_DATABASE_URL الحقيقي. كما يستدعي package-release.sh `npx prisma@7.9.1 validate` خارج الشجرة المقلمة. قد يعود الاعتماد الضعيف إلى بيئة أدوات النشر رغم غيابه من artifact. لم أختبر وصول المسار الضعيف أو إعدادات TLS/المصادقة أو قابلية الاستغلال، ولم أشغّل الأدوات على خادم حي.

أُبلغ المدير، وسجل `deployment-prisma-dependency-review` شرط مراجعة قبل الإصدار التالي. خطر الأدوات **مفتوح** ويحتاج معالجة مستقلة؛ لم نغيّر lock أو أدوات النشر.

## القيود والمتبقي

المدخلات ومفاتيح المحاولة في الذاكرة؛ انتهاء الجلسة أو تغيير الشركة/المستخدم/الصلاحيات يزيلها. **المدخلات غير المحفوظة تضيع، ولا يوجد وعد بحفظ دائم أو استعادة تلقائية.** بعد نتيجة كتابة مجهولة ثم مغادرة السياق، يلزم مراجعة سجلات الشركة الأصلية قبل إعادة الإدخال؛ لم تُبن منظومة استرداد دائمة.

لم يُختبر backend أو MySQL أو جلسة حية أو كل صفحات التطبيق أو مسودات POS أو تغيير الهوية من تبويب آخر أو متصفحات غير Chromium. لم تُنشأ حزمة نشر Linux ولم يُجر CI بعيد أو push أو PR أو دمج بعيد أو نشر. التسليم مرشح محلي للمراجعة، ويبقى خطر أدوات النشر وقبول سياسة فقد المدخلات ومراجعة المدير قبل الإصدار.
