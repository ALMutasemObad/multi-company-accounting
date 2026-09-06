# تسليم الشريحة المحلية للوحدات الاختيارية

الفرع: `task/optional-modules-slice`. الأساس: `9be397c7a435720c921425b6cb7b64e5dbab7ebc`. الحالة: مكون واختبارات ومعاينة محلية، بانتظار مراجعة وربط المدير؛ لا push أو PR أو CI بعيد أو دمج أو نشر أو وصول لبيانات حية.

## المنفذ

- `apps/web/src/optional-modules/OptionalModulesCatalog.tsx`: عرض وحدات نسخة الخطة الحالية والاستحقاقات خارجها؛ فصل حالة الكتالوج عن الاستحقاق عن لقطة صلاحيات المستخدم، ومتطلبات ورسوم نصية دون حساب مالي. حجب اختلاف الحساب/الشركة وغياب صلاحية العرض. لا API أو زر تفعيل أو تغيير اشتراك.
- `optional-modules.css`: RTL ومقاسان 16/20 بكسل افتراضيًا، بطاقات متجاوبة دون خط زخرفي.
- `fixture-data.ts` و`fixture.tsx` و`fixture.html`: معاينة DEV منفصلة ببيانات تركيبية، تستعير منشئ snapshot الاختباري الموجود فقط. أسماء الوحدات والرسوم والاعتماديات هنا حالات محاكاة وليست جرد كتالوج شركة فعلية. ليست مستوردة في مسارات الإنتاج.
- `OptionalModulesCatalog.test.tsx` و`vitest.config.mjs`: 21 اختبارًا سلوكيًا.
- `verify-fixture.mjs`: تحقق Chromium قابل للإعادة للمعاينة بعرضي 1440 و390، ينتج الصور في `tmp/optional-modules` المتجاهل.
- `docs/architecture/OPTIONAL_MODULES_SLICE_AR.md`: جرد الكود الفعلي، فروق الاستحقاق والقدرات، الملفات الدقيقة المطلوبة للربط وأولويات التفعيل/التعطيل دون حذف البيانات.

## التحقق الفعلي

نجح `Workspace.ps1 -Action Check -Refresh` بعد زوال قفل مهمة أخرى دون حذف القفل. ثُبت npm 12.0.2 الرسمي في TEMP بعد مطابقة SHA-512 مع registry، ثم `npm ci --ignore-scripts --no-audit --no-fund` من lock في worktree مستقل: 359 حزمة. لم يتغير lock ولم تُنسخ node_modules ولم يُولد Prisma (لا API في هذه الشريحة).

الأوامر من جذر worktree مع Node المتاح في الجلسة:

```powershell
node node_modules/vitest/vitest.mjs run --config apps/web/src/optional-modules/vitest.config.mjs
node node_modules/vitest/vitest.mjs run --config subscription-upgrade-vitest.config.mjs apps/web/src/module-entitlements.test.ts apps/web/src/authorization.test.ts
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false
node node_modules/vite/bin/vite.js build apps/web --outDir ../../tmp/optional-modules/web-build
```

النتائج: 21 اختبارًا جديدًا و18 اختبارًا قائمًا للاستحقاقات والصلاحيات ناجحة؛ TypeScript لكل مصدر الواجهة ناجح؛ بناء واجهة الإنتاج ناجح. تحذير حجم chunk موجود في البناء (`employee-expenses` أكبر من 500 kB)، وتحذير outDir خارج جذر تطبيق الويب؛ لا فشل بناء. المكون غير موصول، لذلك بناء الإنتاج يثبت عدم كسر التطبيق القائم، بينما TypeScript وVitest وVite DEV تختبر المكون نفسه.

تشغيل المعاينة في جلسة أولى، ثم التحقق في جلسة ثانية:

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186 --strictPort
node apps/web/src/optional-modules/verify-fixture.mjs
```

الرابط المحلي: `http://127.0.0.1:5186/apps/web/src/optional-modules/fixture.html`.

نجح تحقق Chromium بعرضي 1440/390: 6 بطاقات، RTL، مقاسان محسوبان 16/20، دون تجاوز أفقي أو أخطاء JavaScript. تبديل الشركة وصلاحية العرض يخفي البطاقات، فشل القراءة يعرض alert، والطلب المعلق لا يتحول لتفعيل. لا استدعاءات `/api/` ولا أزرار تفعيل. روجعت الصورتان بصريًا؛ النصوص والبطاقات واضحة ولا قص أو تداخل. الصور المحلية: `tmp/optional-modules/catalog-1440.png` و`catalog-390.png`؛ لا تتبع في Git.

## ما لم يختبر والمتبقي

لم يختبر ربط صفحة الاشتراك أو `/auth/me` الفعلي، ولا قاعدة MariaDB/MySQL أو تزامن عمليات مجال أو CI بعيد أو نشر أو جهاز هاتف فعلي. المقاسات الصغيرة محاكاة Chromium. لا ادعاء أن التعطيل آمن بمجرد إخفاء الواجهة؛ ملف المعمارية يحدد المراجعات المطلوبة. الرسوم والحالات بالمعاينة تركيبية، ولم ترسل طلبات تغيير أو دفع.

الربط ينتظر انتهاء التكامل وتسلسل المدير لملف `CompanySubscriptionPage.tsx`؛ لا يحتاج مبدئيًا تغيير عقد أو lock. النصوص عربية فقط؛ يلزم توصيل اللغات الأخرى واختبارات LTR عند إدخاله في التطبيق متعدد اللغات. حفظ حداثة الغلاف وقت التحديث وفشل القراءة مسؤولية loader المستقبلي، ولا يثبت تطابق الشركة وحده حداثة البيانات.

الالتزام النهائي يسجل عبر `MarkReady` في سجل مساحة العمل؛ هذا المستند داخل الالتزام نفسه. اكتمال الشريحة يعني جاهزيتها للمراجعة المحلية، وليس تفعيل وحدات أو نشرها.
