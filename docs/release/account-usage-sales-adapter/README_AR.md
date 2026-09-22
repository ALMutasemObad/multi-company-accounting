# ADM-1B3 — محول استعمال الحسابات في Sales

## النتيجة

- أضيف `SalesAccountUsageQueryAdapter` داخل سياق Sales ويستخدم
  `Prisma.TransactionClient` الممرر فقط.
- يعيد الفئات بالترتيب الثابت: `SALES_CUSTOMER` ثم `SALES_SELLING_PROFILE` ثم
  `SALES_INVOICE_HISTORY`.
- تعد استعلامات Customer وSelling Profile وSales Invoice Line المراجع بشرط
  `companyId + accountId` المناسب لكل عمود.
- يشمل `SALES_INVOICE_HISTORY.count` كل الأسطر، بما فيها `DRAFT`. أما
  `hasImmutableHistory` فيستخدم `findFirst/select id` ويصبح true فقط عند ارتباط سطر
  بفواتير `POSTED` أو `REVERSED` أو `CANCELLED`، مع تثبيت `companyId` على السطر
  والفاتورة والمستند، وتقييد نوع المستند إلى `SALES_INVOICE/SALES_CREDIT_NOTE`.
- سجل composition محولات Core وSales وReporting فأصبحت الحالة 3/7، وبقيت محولات
  Purchases/Tax/Treasury/Inventory مفقودة مع `enforcementEnabled=false`.
- بقي `AccountService` بلا حقن للحارس، فلا يوجد تفعيل جزئي لدورة حياة الحساب.
- أضيف اعتماد Sales type-only الصريح إلى سياسة الحدود، ويمنع Runtime import للعقد.
- ثُبتت مراجع الحسابات التي يكتبها Sales عبر `AccountReferenceLockPort` داخل
  المعاملة نفسها وقبل الكتابة: إنشاء Customer وتغيير حسابه الفعلي، وإنشاء أو إعادة
  تفعيل Selling Profile وتغيير حساب إيراده، وتجهيز Sales Invoice. لا تقفل تحديثات
  Customer/Selling Profile التي لا تغيّر المرجع.
- يجمع Sales Invoice حسابات الإيراد ويزيل التكرار ويرتب المعرّفات تصاعديًا، ثم
  يقفلها بالتتابع قبل قراءة الحسابات أو حفظ/استبدال الأسطر. يرفض أي حساب غير مؤهل
  مغلقًا، ولا تستورد الخدمات محول Prisma الملموس؛ يحقنه composition فقط.

لا يوجد تغيير schema أو migration أو OpenAPI أو سلوك HTTP.

## التحقق المحلي

- `@mcap/api` TypeScript typecheck: ناجح.
- اختبارات Vitest المركزة للمحول والتركيب وwriter handshakes والحواجز: 91/91 ناجحة
  في 10 ملفات.
- اختبارات سياسة الحدود: 46/46 ناجحة.
- المسح الفعلي للحدود: 343 ملفًا و1495 import، صفر مخالفة وصفر تحذير مراجعة.

## القيود والمتبقي

- لا يفعّل `AccountUsageGuard` حتى تكتمل محولات المالكين الأربعة المتبقية.
- لا يعلن Prisma حاليًا فهرسًا صريحًا مطابقًا لـ
  `Customer(companyId, receivableAccountId)`؛ لم تُضف migration في هذه الشريحة،
  ويلزم قياس خطة التنفيذ وحجم البيانات قبل قرار فهرس مستقل.
- لم تشغّل حزمة قاعدة البيانات الكاملة ضمن هذه الشريحة المحدودة.
- لا push أو PR أو merge أو deploy.
