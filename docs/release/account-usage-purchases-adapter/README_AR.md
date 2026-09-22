# ADM-1B4 — محول استعمال الحسابات في Purchases

## النتيجة

- أضيف `PurchasesAccountUsageQueryAdapter` داخل سياق Purchases ويستخدم
  `Prisma.TransactionClient` الممرر فقط.
- يعيد الفئتين بالترتيب الثابت: `PURCHASES_SUPPLIER` ثم
  `PURCHASES_INVOICE_HISTORY`، مع عزل كل استعلام بـ`companyId`.
- يشمل عدد تاريخ الفواتير كل `PurchaseInvoiceLine` بما فيها `DRAFT`، بينما يصبح
  `hasImmutableHistory=true` فقط لـ`POSTED/REVERSED/CANCELLED` مع تقييد نوع
  المستند إلى `PURCHASE_INVOICE/PURCHASE_DEBIT_NOTE` وعزل الشركة على السطر
  والفاتورة والمستند.
- سجل composition محولات Core وSales وPurchases وReporting فأصبحت الحالة 4/7،
  وبقيت Tax/Treasury/Inventory مفقودة مع `enforcementEnabled=false` ودون حقن
  الحارس في `AccountService`.
- يقفل `SupplierService` مرجع الحساب داخل المعاملة قبل الإنشاء، وكلما حمل طلب
  التحديث `payableAccountId` حتى إن ساوى القيمة المقروءة؛ التحديث الذي لا يحمل
  الحقل وحده يتجاوز القفل.
- تقفل create/update/createImportedDraft حسابات خصم الفاتورة بعد إزالة التكرار
  وترتيب المعرّفات رقميًا، قبل قراءتها أو كتابة الأسطر. يعمل preview وpost
  validate-only لتجنب ترتيب أقفال معكوس.
- إذا أعاد ترحيل المخزون `inventoryAccountId` بديلًا، يقفله post داخل المعاملة قبل
  `PurchaseInvoiceLine.updateMany`. لا ينفذ قفلًا أو تحديثًا إذا كانت البنود
  المخزنية تستخدم الحساب نفسه أصلًا.
- تعتمد خدمات Purchases وSuppliers على `AccountReferenceLockPort` type-only؛ محول
  Prisma الملموس محصور في composition.

لا يوجد تغيير schema أو migration أو OpenAPI أو سلوك HTTP.

## التحقق المحلي

- `@mcap/api` TypeScript typecheck: ناجح.
- اختبارات Vitest المركزة للمحول والتركيب وwriter handshakes والحواجز: 86/86
  ناجحة في 9 ملفات.
- اختبارات سياسة الحدود: 47/47 ناجحة.
- المسح الفعلي للحدود: 344 ملفًا و1500 import، صفر مخالفة وصفر تحذير مراجعة.

## القيود والمتبقي

- لا يفعّل `AccountUsageGuard` حتى تكتمل محولات المالكين الثلاثة المتبقية.
- لا يعلن Prisma فهرسًا صريحًا مطابقًا لـ`Supplier(companyId, payableAccountId)`؛
  لم تُضف migration في هذه الشريحة، ويلزم قياس خطة التنفيذ وحجم البيانات قبل قرار
  فهرس مستقل.
- لم تشغّل حزمة قاعدة البيانات الكاملة.
- لا push أو PR أو merge أو deploy.
