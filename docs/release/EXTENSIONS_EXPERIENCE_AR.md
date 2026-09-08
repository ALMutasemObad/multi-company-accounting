# تجربة الإضافات والوحدات الاختيارية

التاريخ: 2026-09-08. المهمة `extensions-experience` على الفرع `task/extensions-experience`، مبنية من `origin/main` عند `731fc11f3635143558fcd6431b864afd0807ff53`. هذا تسليم محلي للمراجعة؛ لم يحدث push أو PR أو دمج أو نشر، ولم تُستخدم بيانات حية.

## النتيجة المنفذة

- أضيفت مرشحات مرئية مع عدادات للكل، والمشمولة في نسخة الخطة، والاختيارية فيها، والإضافات المسجلة حاليًا.
- بقي بعدا التصنيف منفصلين: `INCLUDED/OPTIONAL` يصفان موضع الوحدة في نسخة الخطة، بينما `ADD_ON` يصف مصدر الاستحقاق النافذ. قد تظهر الوحدة نفسها في مرشحي «اختيارية» و«إضافة حالية»، وتشرح الواجهة هذا التداخل صراحة.
- أضيفت شارات مستقلة لنوع الإدراج ومصدر الاستحقاق. لم يتحول الطلب المعلق أو التغيير المجدول إلى استحقاق، ولم تستنتج الواجهة حل الاعتماديات أو القدرة التشغيلية محليًا.
- أزرار المرشحات تغير العرض محليًا فقط. لا يملك الكتالوج نموذجًا أو رابطًا أو إدخالًا أو طلب API، ويبقى تغيير الوحدات في رحلة اختيار الاشتراك والمراجعة والتأكيد القائمة في الصفحة نفسها. إرسال الطلب ليس تفعيلًا أو دفعًا.
- بقي حجب اختلاف المستخدم أو الشركة وفشل القراءة قبل رسم البطاقات. لا تعرض المرشحات لقطة سابقة، ولا تغيّر حماية loader القائمة من الردود المتأخرة.
- اكتملت نصوص المرشحات ومعانيها بالعربية والإنجليزية والأردية والهندية، مع اتجاهي RTL/LTR. تستخدم البطاقات والمرشحات مقاسي 16 و20 بكسل فقط.

## الملفات

- `apps/web/src/optional-modules/OptionalModulesCatalog.tsx`
- `apps/web/src/optional-modules/optional-modules.css`
- `apps/web/src/optional-modules/OptionalModulesCatalog.test.tsx`
- `apps/web/src/optional-modules/fixture.tsx`
- `apps/web/src/i18n/locales/optional-modules.ts`
- `tests/visual/extensions-next-wave.spec.ts`
- `docs/release/EXTENSIONS_EXPERIENCE_AR.md`

لم تتغير `CompanySubscriptionPage.tsx` لأن مسار المراجعة وحماية القراءة كانا موصولين بالفعل، ولم يتغير `App.tsx` أو OpenAPI أو Prisma أو migrations أو ملف القفل.

## التحقق المحلي

ثُبتت اعتماديات المهمة وحدها من ملف القفل بواسطة npm 12.0.2 مع `--ignore-scripts` ومخزن التنزيل `E:/DevelopmentCaches/npm`. لم تُشارك `node_modules` أو Prisma مع مهمة أخرى.

```powershell
node node_modules/vitest/vitest.mjs run --config apps/web/src/optional-modules/vitest.config.mjs
node node_modules/typescript/bin/tsc -b apps/web --pretty false
node node_modules/typescript/bin/tsc -p tsconfig.integration.json --noEmit --pretty false
node node_modules/vite/bin/vite.js build apps/web
node scripts/check-web-i18n.mjs
node scripts/check-web-ui.mjs
node node_modules/@playwright/test/cli.js test --config playwright.integration.config.ts tests/visual/extensions-next-wave.spec.ts --project desktop-1440 --project mobile-390
git diff --check
```

النتائج:

- Vitest: ملف واحد، 26 اختبارًا ناجحًا.
- TypeScript للواجهة واختبارات integration: exit 0.
- بناء Vite للإنتاج: exit 0. بقي تحذير الحزمة السابقة `employee-expenses` الأكبر من 500 kB؛ لا يرتبط بملفات هذه المهمة.
- بوابتا i18n وواجهة الويب: ناجحتان.
- Playwright: 10 اختبارات ناجحة؛ اللغات الأربع على عرضي 390 و1440، مع تصفية فعلية، وطلب معلق، واختلاف شركة، وفشل قراءة، وعدم وجود كتابة API أو تجاوز أفقي، وثبات مقاسي الخط.
- `git diff --check`: ناجح؛ تحذيرات تحويل LF إلى CRLF تخص إعداد working copy ولا تمثل خطأ فروق.

## حدود النتيجة

اختبارات المتصفح تستخدم fixture محليًا ببيانات تركيبية ولا تثبت قاعدة البيانات أو RBAC الخادمي أو idempotency أو MariaDB/MySQL. لم تُنفذ سياسة تعطيل جديدة لحالات الاشتراك، ولم تُضف عملية تفعيل أو تحليل أثر إزالة على العمليات المفتوحة. تلك أعمال مستقلة عند مالك الاشتراكات وتتطلب عقدًا وقرار منتج قبل عرضها كحالة تشغيلية.

**Barcode Impact:** لا تغيير لإدخال الأصناف أو البنود أو المستندات أو الماسح أو الطباعة؛ التغيير عرض اشتراك فقط.
