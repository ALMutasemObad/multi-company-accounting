# ADM-1B2 — محول استعمال الحسابات في Core Accounting

## النتيجة

- أضيف `CoreAccountUsageQueryAdapter` داخل سياق Accounts ويستخدم
  `Prisma.TransactionClient` الممرر فقط.
- يعيد الفئتين بالترتيب الثابت: `CORE_ACCOUNT_CHILD` ثم
  `CORE_JOURNAL_HISTORY`.
- يعد الأبناء بشرط `companyId + parentAccountId`، ويعد كل سطور اليومية بشرط
  `companyId + accountId`.
- تكون `hasImmutableHistory=true` لسجل اليومية فقط عند وجود سطر مرتبط عبر
  `JournalEntry` بمستند `AccountingDocument` نهائي حالته `POSTED` أو `REVERSED` أو
  `CANCELLED`؛ تبقى `DRAFT` وحدها قابلة للتعديل. يستخدم فحص الوجود `findFirst` محدودًا مع
  `select id` ويثبت نطاق الشركة على السطر والقيد والمستند.
- سجل composition محولي Core وReporting فأصبحت الحالة 2/7، وبقي المالكون
  Sales/Purchases/Tax/Treasury/Inventory مفقودين مع `enforcementEnabled=false`.
- بقي `AccountService` بلا حقن للحارس؛ لا يوجد تفعيل جزئي لدورة حياة الحساب.
- أضيف مسار المحول إلى سياق `account-lifecycle` في حارس الحدود.

لا يوجد تغيير schema أو migration أو OpenAPI أو سلوك HTTP.

## التحقق المحلي

- اختبارات المحول والتركيب والمنسق وحواجز المصدر المركزة: 64/64 ناجحة.
- اختبارات سياسة الحدود: 45/45 ناجحة.
- فحص المستودع الحقيقي: 342 ملفًا و1485 import، بلا مخالفة أو تحذير مراجعة.
- Typecheck للـAPI، بما فيه اختبارات TypeScript: ناجح.

## القيود والمتبقي

- لا يفعّل `AccountUsageGuard` حتى تكتمل محولات المالكين الخمسة المتبقية.
- لم تشغّل حزمة قاعدة البيانات الكاملة ضمن هذه الشريحة المحدودة.
- لا push أو PR أو merge أو deploy.
