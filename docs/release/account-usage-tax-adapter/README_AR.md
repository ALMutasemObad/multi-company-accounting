# ADM-1B5 — محول استعمال الحسابات في Tax

## النتيجة

- أضيف `TaxAccountUsageQueryAdapter` داخل سياق Tax ويستخدم
  `Prisma.TransactionClient` الممرر فقط.
- يعيد fact واحدة `TAX_RATE` تعد كل معدل داخل الشركة إذا ساوى الحساب
  `outputTaxAccountId` أو `inputTaxAccountId`.
- تبقى `hasImmutableHistory=false` لأن TaxRate تعيين حالي؛ تاريخ الفواتير تغطيه
  سياقات المستندات وCore Accounting.
- سجل composition محولات Core وSales وPurchases وTax وReporting فأصبحت الحالة
  5/7، وبقي Treasury وInventory مفقودين مع `enforcementEnabled=false` ودون حقن
  الحارس في `AccountService`.
- يجمع `TaxService` كل accountId غير null سيُحفظ، يزيل التكرار ويرتب المعرّفات
  رقميًا، ثم يقفلها عبر `AccountReferenceLockPort` داخل المعاملة قبل create/update.
- يقفل update كل `accountId` مصرح به حتى إن ساوى snapshot الحالي؛ غياب الحقل فقط
  لا يقفل، ويبقى شرط `version` في `updateMany` هو CAS النهائي.
- يعتمد Tax على العقد type-only، ويحقن server وdemo seed محول Core الملموس صراحة.

لا يوجد تغيير schema أو migration أو OpenAPI أو سلوك HTTP.

## التحقق المحلي

- `@mcap/api` TypeScript typecheck: ناجح.
- اختبارات Vitest المركزة للمحول والخدمة والتركيب والحواجز: 94/94 ناجحة في 10 ملفات.
- اختبارات سياسة الحدود: 48/48 ناجحة.
- المسح الفعلي للحدود: 345 ملفًا و1504 imports، صفر مخالفة وصفر تحذير مراجعة.

## القيود والمتبقي

- لا يفعّل `AccountUsageGuard` حتى يكتمل محولا Treasury وInventory.
- لا يعلن Prisma فهرسًا صريحًا مطابقًا لحقلَي حساب TaxRate مع `companyId`؛ لم تضف
  هذه الشريحة migration، ويلزم قياس خطة التنفيذ وحجم البيانات قبل قرار الفهرسة.
- لم تشغّل حزمة قاعدة البيانات الكاملة.
- لا push أو PR أو merge أو deploy.
