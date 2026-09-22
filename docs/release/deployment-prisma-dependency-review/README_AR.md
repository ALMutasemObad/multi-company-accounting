# مراجعة بوابة اعتماد Prisma للنشر

## النتيجة

لا توجد فجوة تنزيل اعتماد غير مقفل في مسار بناء الإصدار أو ترحيله الحالي؛ لذلك لم
نغيّر `package-lock.json` أو نرقّي Prisma أو `mysql2`.

## سلسلة التنفيذ المثبتة

1. تثبّت CI اعتمادات المستودع من `package-lock.json` عبر `npm ci` ثم تبني الأصول
   وتولّد Prisma. استدعاءات CI إلى `npm exec -w @mcap/api -- prisma` تعتمد نسخة
   مساحة العمل المقفلة `prisma@7.9.1`، وليست `npx` تنزيلًا مؤقتًا.
2. يبني `scripts/release/package-release.sh` أداة ترحيل مستقلة في
   `deploy/scripts/prisma-toolchain` عبر `npm ci --prefix` من lockfile الخاص بها
   قبل إنشاء الـmanifest. تضم الحزمة `deploy/scripts` كاملًا، بما فيه
   `prisma-toolchain/node_modules`، ويحميه `release-manifest.json` بالهاش.
3. يتحقق المثبّت `deploy/scripts/install-cpanel-release.sh` من manifest قبل أي
   ترحيل، ثم يستدعي فقط `prisma-toolchain/run.mjs migrate deploy`. لا يوجد
   `npx` أو `npm install` أو `npm exec` في المثبّت، فلا يستطيع المضيف تنزيل Prisma
   أو محركه عند النشر.
4. يرفض المشغّل أي CLI أو `mysql2` أو `@prisma/engines` خارج شجرة الأداة أو بنسخة
   غير معتمدة. كما يعيّن `PRISMA_SCHEMA_ENGINE_BINARY` إلى المحرك الموجود في
   الأرشيف، فيمنع fallback لتنزيل محرك Prisma.

## القفل الفعلي

تحمل lockfile الرئيسية وlockfile الأداة المستقلة كلتاهما سجلات registry مع
`integrity` لـ`prisma@7.9.1` و`@prisma/engines@7.9.1` و`mysql2@3.23.1`؛ والـoverride
في manifest كل منهما يفرض `mysql2@3.23.1`. وجود `mysql2@3.15.3` ضمن تبعيات Prisma
الاسمية لا يحدد النسخة المثبتة: lockfile والـoverride يثبتان النسخة الفعلية
`3.23.1`، ويعيد المشغّل التحقق منها قبل التنفيذ.

## التحقق المنفذ والقيود

- نجح فحص Node ساكن يقرأ lockfileين ويتحقق من النسخ و`resolved` و`integrity` لكل
  حزمة حرجة.
- نجح البحث الساكن: لا يوجد `npx prisma` أو `prisma@7.9.1 migrate` أو
  `MCAP_NPX_CLI` في packager أو المثبّت أو toolchain؛ الاستدعاء الوحيد هو المشغّل
  المقفل.
- لم نعتمد على `npm audit` دليلًا لهذه النتيجة؛ المراجعة تتبع مسار التنفيذ
  والـlockfiles والـmanifest والمشغّل الفعلي.
- لم نثبّت اعتمادًا. لذلك لم يمكن تشغيل اختبارَي السائق في
  `deployment-toolchain-safety.test.mjs` اللذين يتطلبان `mysql2` محليًا، كما أن
  `deployment-scripts.test.mjs` يحتاج حزمة `yaml`. نجحت الأجزاء الخمسة المستقلة
  من اختبار toolchain قبل أن تتوقف حالتا السائق بسبب غياب `node_modules`، وهي
  ليست نتيجة فشل وظيفي للحارس.

لا يثبت هذا العمل تنفيذ بناء CI أو ترحيل قاعدة بيانات أو نشر فعلي؛ تلك تبقى ضمن
CI/بيئة النشر المعتمدة.
