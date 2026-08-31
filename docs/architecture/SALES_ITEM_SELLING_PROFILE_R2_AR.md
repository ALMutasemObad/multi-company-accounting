# R2 — عقد ملف بيع الصنف وكتالوج البيع

التاريخ: 2026-08-31. اعتمد المنسق هذا الحد قبل تعديل Prisma/OpenAPI.

## الملكية والنطاق

Sales وحده يكتب `SalesItemSellingProfile` / `sales_item_selling_profiles`، صف واحد
لكل `(companyId, inventoryItemId)`، دون رمز بشري جديد أو hard delete. الحقول:
`id`, `companyId`, `inventoryItemId`, `unitPrice Decimal(19,4)`, `currencyId`,
`revenueAccountId`, `taxRateId?`, `isActive`, `version` يبدأ من1، وتاريخا الإنشاء والتعديل.
علاقات الشركة المركبة مع InventoryItem/Account/TaxRate/CompanyCurrency كلها Restrict.
السعر غير سالب؛ الصفر سعر صريح وليس ملفًا مفقودًا. لا قوائم أسعار/خصومات أو سياسة
منع override جديدة. الافتراضات لا تغير مستندًا تاريخيًا أو تعيد تسعير سلة تلقائيًا.

## HTTP المعتمد

- `GET /sales/catalog?page=1&pageSize=24&search=`؛ page من1 إلى10000، الحجم1..100،
  البحث مقصوص بطول أقصى100 بلا محارف تحكم. بحث DB في code/nameAr/nameEn، ترتيب
  ثابت code ثم id، لا lookup باركود موازٍ. تعرض القائمة أصناف الشركة حتى غير المهيأة.
- `GET /sales/catalog/items/{inventoryItemId}`؛ يستخدم بعد Inventory scanner resolve.
- `POST /sales/catalog/items/{inventoryItemId}/selling-profile`؛ الجسم
  `{unitPrice,currencyId,revenueAccountId,taxRateId}`، taxRateId اختياري ويصبح null.
- `PATCH` للمسار نفسه؛ version إلزامية، وحقول السعر/المراجع/isActive اختيارية.
  تعطيل الملف لا يتطلب صلاحية المراجع القديمة؛ تعديل المراجع أو إعادة التفعيل يتحقق
  من المالكين. version قديمة تعيد409 ولا يعاد تطبيق الجسم تلقائيًا.

القائمة `{data: SellingCatalogItem[], meta:{page,pageSize,total,totalPages}}`،
والمفرد والكتابة `{data:SellingCatalogItem}`.

```ts
type SellingCatalogItem = {
  inventoryItemId: string; code: string; nameAr: string; nameEn: string|null;
  description: string|null; isActive: boolean;
  unitOfMeasure: {id:string;code:string;nameAr:string;nameEn:string|null;
    decimalPlaces:number;isActive:boolean};
  sellingProfile: null | {id:string;unitPrice:string;currencyId:string;
    currencyCode:string|null;revenueAccountId:string;taxRateId:string|null;
    isActive:boolean;version:number};
  isReady: boolean;
  readinessReason: null | "PROFILE_MISSING" | "PROFILE_INACTIVE" | "ITEM_INACTIVE"
    | "UNIT_INACTIVE" | "CURRENCY_UNAVAILABLE" | "REVENUE_ACCOUNT_INVALID"
    | "TAX_RATE_INVALID";
};
```

BIGINT وDecimal نصوص، السعر fixed4. currencyCode قد يكون null إذا أصبحت العملة غير
متاحة؛ لا يستنتج العميل رمزًا بديلًا. `isReady` أهلية المراجع الحالية فقط وليس ضمان
المخزون أو الفترة أو الصندوق أو نجاح Checkout. اختلاف عملة السلة يمنع تطبيق السعر
آليًا؛ لا تحويل عملة ضمن هذا الحد. حقول سطر البيع الصريحة تظل معتمدة في Sales.

## الصلاحيات والمعاملة

القراءة `sales_catalog.view`، الكتابة `sales_catalog.manage` + CSRF + Idempotency-Key.
لا تمنح أي منهما صلاحيات Inventory/Accounts العامة. R0 يربطها باستحقاق SALES؛ POS
يعتمد SALES. تضاف للأدوار الإدارية المرجعية حسب سياسة الترحيلات القائمة فقط.
الشركة من الجلسة. الكتابة/النسخة/Audit/Idempotency في TransactionExecutor واحد،
لا شبكة أو Outbox بلا مستهلك، ولا كتابة Ledger. FK يمنع تسرب المراجع بين الشركات.
الملف مصدر إعداد لا ماليًا نهائيًا؛ يعاد فحص المراجع عند كل قراءة وكل أمر بيع.

## المنافذ والتركيب

`SellingCatalogQueryPort` للقراءة، وoutbound ports صغيرة للصفحة وهوية Inventory
ولدفعات حسابات Accounting وعملات Tenant وجاهزية OUTPUT المملوكة لـTax.
InventoryInvoiceCatalogPort الحالي يبقى لتأليف الفاتورة؛ لا يناسب الصفحة لأنه يشترط
مستودعًا ويعيد أصنافًا مختارة فقط. المحولات الجديدة في مجلد مالك البيانات، وتتلقى
TransactionClient نفسه؛ لا Prisma records كعقد بين المجالات ولا N+1 في عرض الصفحة.
`createSellingProfileService` تركيب مستقل؛ R0 وحده يربط app/server والاستحقاق وUI.

## Barcode Impact وبوابات الإصدار

النقر والمسح يصلان لنفس itemId؛ InventoryBarcodeScanner وInventory resolve يملكان
التطبيع وleading zeros والصلاحيات. لا تعديل جدول باركود أو parser أو تغيير كمية من
قيمة الباركود. R1 يمنع Checkout أثناء resolve/تحميل defaults ويتجاهل الاستجابة
القديمة ولا يكتب فوق تعديل الكاشير. المحاكاة ليست اعتماد قارئ أو طابعة.

اختبارات مطلوبة: Decimal وحدود البحث، عزل الشركة/FK، صلاحيات وCSRF، نسخة وتنافس
وIdempotency/rollback/Audit، O(1) batch reads، عقد وحراس واستجابات، typecheck/build،
وترحيل fresh+upgrade على MariaDB10.11/MySQL8.4 قبل الدمج. توليد Prisma في runtime
معزول فقط. لا نشر/Push/PR/Merge أو تحصيل حقيقي ضمن R2.
