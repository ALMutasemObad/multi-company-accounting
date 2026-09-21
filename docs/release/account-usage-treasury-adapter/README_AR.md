# ADM-1B6 — محول استعمال الحسابات في Treasury

## النتيجة

- أضيف `TreasuryAccountUsageQueryAdapter` ويستخدم `Prisma.TransactionClient`
  الممرر فقط، ويعيد بالترتيب `TREASURY_CASH_BANK_ACCOUNT` ثم
  `TREASURY_DOCUMENT_HISTORY`.
- يعد الأول كل `CashBankAccount.ledgerAccountId` داخل الشركة. ويجمع الثاني كل
  `Receipt/Payment.counterAccountId` في total، مع عزل الشركة وتقييد نوع المستند،
  ويجعل التاريخ immutable فقط لحالات `POSTED/REVERSED/CANCELLED`؛ تبقى `DRAFT`
  استعمالًا قابلًا للتعديل.
- يسجل composition ستة مالكين من سبعة؛ يبقى Inventory وحده مفقودًا وتظل
  `enforcementEnabled=false` بلا حقن الحارس في `AccountService`.
- يعتمد `TreasuryService` و`ReceiptService` و`PaymentService` على
  `AccountReferenceLockPort` type-only. تُزال التكرارات وتُرتب المعرّفات رقميًا،
  ويجري القفل على `TransactionClient` نفسه قبل كتابة المرجع.
- يحجز إنشاء Cash/Bank تسلسل الكود قبل قفل الحساب لتثبيت ترتيب الأقفال، ثم يقفل
  قبل create. ويحجز مسار POS رقم Receipt قبل قفل direct counter account للسبب
  نفسه. ويقفل update كل `ledgerAccountId` مصرح به حتى إن ساوى snapshot، مع
  بقاء version CAS الحكم النهائي؛ غياب الحقل لا يقفل.
- تقفل Receipt/Payment direct counter account في create وكلما حمل update الحقل،
  حتى إن ساوى القيمة الحالية. post يتحقق بلا قفل لأنه لا يستبدل المرجع.

لا يوجد تغيير schema أو migration أو OpenAPI أو سلوك HTTP.

## استثناء bootstrap

`apps/api/prisma/demo-seed.ts` يكتب مراجع تأسيسية مباشرة، ومنها Cash/Bank، مثلما
يكتب Customer/Supplier/TaxRate. هو bootstrap offline خارج أوامر runtime/concurrency؛
يجب ألا يشغّل بالتوازي مع الخدمة، ولم تضف الشريحة قفلًا شكليًا لمسار واحد منه.

## التحقق المحلي

- نجح TypeScript typecheck لمصدر API واختباراته.
- نجحت مجموعة Vitest المركزة: 41 اختبارًا، مع تخطي 23 اختبار تكامل قاعدة بيانات
  لأنها تتطلب `RUN_DB_TESTS=true` وقاعدة MariaDB مهيأة.
- نجحت اختبارات سياسة الحدود 49/49، ونجح المسح الحقيقي لـ346 ملفًا و1510 import
  بلا مخالفة أو تحذير مراجعة.
- لم تشغّل حزمة قاعدة البيانات الكاملة.

## القيود والمتبقي

- لا يفعّل `AccountUsageGuard` حتى يكتمل محول Inventory.
- لا تعلن Prisma فهارس صريحة مطابقة لـ`companyId + ledgerAccountId` أو
  `companyId + counterAccountId` في الجداول الثلاثة؛ لم تضف هذه الشريحة migration،
  ويلزم قياس خطة التنفيذ والحجم قبل قرار الفهرسة.
- لا push أو PR أو merge أو deploy.
