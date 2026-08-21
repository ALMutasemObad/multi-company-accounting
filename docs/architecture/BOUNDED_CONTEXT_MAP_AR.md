---
title: "Bounded Context Map"
status: "accepted target architecture"
version: "1.0"
last_updated: "2026-08-21"
---

# خريطة الـBounded Contexts وملكية البيانات

## 1. الهدف

تحدد هذه الوثيقة المالك المنطقي لكل مفهوم، واتجاهات الاعتماد المسموحة. هي Target Architecture تدريجية؛ بعض الكود الحالي لا يزال مخالفًا لها كما هو موثق في تقرير التدقيق.

## 2. قاعدة الملكية

لكل Aggregate وجدول مالك كتابة واحد. وجود Foreign Key أو Prisma relation لا يمنح Context آخر حق تعديل الكيان مباشرة.

## 3. السياقات والملكية المستهدفة

| Context | المسؤولية | ملكية الكتابة المستهدفة | ملاحظات |
|---|---|---|---|
| Identity & Access | الهوية والجلسات والأدوار والصلاحيات واستعادة كلمة المرور | `User`, `Session`, `PasswordResetRequest`, `UserCompany`, `Role`, `Permission`, `RolePermission`, `UserCompanyRole` | يقدم Actor/Application Context لبقية النظام؛ بريد الاستعادة أثر Outbox |
| Tenant & Company Configuration | المؤسسة والشركة والعملات والإعدادات | `Organization`, `Company`, `Currency`, `CompanyCurrency`, `CompanyExchangeRate` | فحص الاستخدام عبر Ports، لا عبر معرفة كل جداول المستندات |
| Registration & Onboarding | دورة التسجيل والتحقق والتنسيق | `RegistrationRequest`, `RegistrationEvent` | Process Manager؛ لا يملك User/Company/Account |
| Core Accounting | السنة والفترة والدليل والمستند والدفتر والترحيل | `FiscalYear`, `FiscalPeriod`, `DocumentSequence`, `AccountingDocument`, `JournalEntry`, `JournalLine`, `AccountType`, `Account`, `CostCenter` | المالك الوحيد للـPosting Engine |
| Sales & Accounts Receivable | العميل والفاتورة والذمة والتحصيل المخصص | `Customer`, `CustomerAddress`, `SalesInvoice`, `SalesInvoiceLine`, receivable items وreceipt allocation policy | لا ينشئ Journal Lines مباشرة |
| Purchases & Accounts Payable | المورد والفاتورة والذمة والسداد المخصص | `Supplier`, `SupplierAddress`, `PurchaseInvoice`, `PurchaseInvoiceLine`, payable items وpayment allocation policy | لا ينشئ Journal Lines مباشرة |
| Treasury | النقد والبنوك وطرق الدفع وحركات القبض والصرف | `CashBankAccount`, `PaymentMethod`, `Receipt`, `Payment` | التنسيق مع AR/AP للتخصيص ومع Ledger للترحيل |
| Tax Configuration | معدلات الضرائب وربط حساباتها | `TaxRate` | مصدر واحد للمبيعات والمشتريات |
| Printing & Document Output | اللقطات التاريخية والتوليد | `DocumentPrintArchive` | يقرأ عبر Document Snapshot Port |
| Reporting | التقارير والقوائم وRead Models | لا يملك حقائق مالية تشغيلية | قراءة فقط، ويمكنه امتلاك projections مستقبلًا |
| Audit | سجل الأعمال والامتثال | `AuditLog` | Append-only، وليس Event Bus |
| Security Monitoring | أحداث المخاطر والإقرار | `SecurityEvent` | يمكنه إصدار تنبيه Integration بعد حفظ الحدث |
| Application Infrastructure | Idempotency وOutbox والتسلسلات التقنية والتشغيل | `IdempotencyRecord`, `OutboxEvent`, `MasterDataCodeSequence` | ليست Bounded Context أعمال؛ توفر حجز الرمز الذري للكيانات المرجعية ولا تملك تلك الكيانات |

## 4. اتجاهات الاعتماد المسموحة

```text
Registration/Onboarding
    ├──> Identity & Access ports
    ├──> Tenant Configuration ports
    └──> Accounting Setup ports

Sales/AR ─────────────> Core Accounting posting port
Purchases/AP ─────────> Core Accounting posting port
Treasury ─────────────> Core Accounting posting port
Treasury ─────────────> AR/AP settlement ports
Sales/Purchases ──────> Tax Configuration query port
All operational contexts ──> Audit append port

Reporting <────────── read/query ports or dedicated read models
Printing  <────────── immutable document snapshot port
```

## 5. قواعد الاتصال بين السياقات

### الاتصال المتزامن

يستخدم عندما تكون النتيجة مطلوبة لحماية invariant في نفس الطلب أو المعاملة، مثل:

- التحقق من الفترة المفتوحة.
- التحقق من صلاحية الحساب.
- التحقق من Outstanding قبل التخصيص.
- إنشاء القيد وتغيير حالة المصدر.
- حجز رقم المستند.

يتم عبر Application/Domain Port صغير. عند الحاجة إلى نفس المعاملة، يجب تمرير `Prisma.TransactionClient` إلى Adapter، لا استخدام Prisma global داخل helper.

### الاتصال غير المتزامن

يستخدم للآثار اللاحقة للـcommit، مثل:

- البريد والتنبيهات.
- التكاملات الخارجية.
- تحديث projections غير الحاكمة.
- التصدير والطباعة الخلفية الكبيرة.

يتم عبر Transactional Outbox وفق ADR-003.

## 6. استثناءات انتقالية موجودة

الاستثناءات التالية موجودة حاليًا ولا تعد نمطًا مسموحًا للنسخ:

- Sales/Purchases/Receipts/Payments/Manual Journals تنشئ Journal Entries مباشرة.
- `ReceiptAllocation` و`PaymentAllocation` يعتمدان على `targetJournalLineId`.
- `CompanyService` يفحص جداول عدة Contexts مباشرة عند تعطيل العملات.
- Tax CRUD موزع بين Sales وPurchases.
- Treasury CRUD مكرر داخل Reference/Supplier services.
- Onboarding يكتب مباشرة في جداول IAM/Tenant/Accounting Setup.

أي Feature جديد يجب ألا يزيد هذه الاستثناءات. إزالتها تتم حسب أولويات الضوابط المعمارية.

## 7. حدود Aggregates المقترحة

| Aggregate | يحمي |
|---|---|
| `SalesInvoice` | الرأس والبنود والحسابات والضريبة وحد الائتمان/الإشعار |
| `PurchaseInvoice` | الرأس والبنود وحسابات المصروف/الأصل والضريبة والإشعار |
| `Receipt` | رأس حركة القبض وبيانات النقد والعملة |
| `Payment` | رأس حركة الصرف وبيانات النقد والعملة |
| `ReceivableSettlement` | تخصيص القبض إلى عناصر الذمم وعدم تجاوز Outstanding |
| `PayableSettlement` | تخصيص الدفع إلى عناصر الذمم وعدم تجاوز Outstanding |
| `AccountingDocument` | الحالة والنسخة والترحيل والعكس والارتباط بالقيود |
| `FiscalPeriod` | الإغلاق وإعادة الفتح والترتيب الزمني |
| `ChartOfAccounts`/`Account` | صلاحية الترحيل والبنية الهرمية |

لا يشترط أن تتحول جميعها إلى Classes كبيرة؛ المطلوب أن تكون invariants والملكية ومداخل التغيير واضحة ومختبرة.
