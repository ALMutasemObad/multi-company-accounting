---
title: "Bounded Context Map"
status: "accepted target architecture"
version: "1.2"
last_updated: "2026-08-24"
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
| Sales & Accounts Receivable | العميل والفاتورة والذمة وسياسة تسوية التحصيل | `Customer`, `CustomerAddress`, `SalesInvoice`, `SalesInvoiceLine`, `ReceivableItem` | يكشف `ReceivableSettlementPort` ولا ينشئ Journal Lines مباشرة |
| Purchases & Accounts Payable | المورد والفاتورة والذمة وسياسة تسوية السداد | `Supplier`, `SupplierAddress`, `PurchaseInvoice`, `PurchaseInvoiceLine`, `PayableItem` | يكشف `PayableSettlementPort` ولا ينشئ Journal Lines مباشرة |
| Treasury | النقد والبنوك وطرق الدفع وحركات القبض والصرف وتخصيصاتها | `CashBankAccount`, `PaymentMethod`, `Receipt`, `ReceiptAllocation`, `Payment`, `PaymentAllocation` | تستخدم التخصيصات هوية العنصر، والتنسيق مع AR/AP وLedger عبر Ports |
| Inventory | المستودعات، ثم الأصناف والوحدات وحركات المخزون والتكلفة تدريجيًا | `Warehouse` حاليًا؛ وتحدد ملكية الكيانات اللاحقة عند تنفيذها | شريحة المستودعات بيانات رئيسية فقط، معزولة حسب الشركة ولا تكتب في Ledger |
| Tax | معدلات الضرائب وربط حساباتها والحساب والتقريب | `TaxRate` | يكشف `TaxQuotePort` للمبيعات والمشتريات ويملك النسخ المتفائلة |
| Printing & Document Output | اللقطات التاريخية والتوليد | `DocumentPrintArchive` | يقرأ عبر Document Snapshot Port |
| Reporting | التقارير والقوائم وRead Models | لا يملك حقائق مالية تشغيلية | قراءة فقط، ويمكنه امتلاك projections مستقبلًا |
| Data Import | تنسيق القوالب والمعاينة والاعتماد الجماعي | `DataImportBatch` فقط | Process Manager؛ يستدعي منافذ المالكين ولا يخزن الملف أو يرحّل الفواتير |
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
Registration/Onboarding ──> Treasury setup port
Sales/Purchases ──────> Tax Configuration query port
Data Import ──────────> Sales/AR, Purchases/AP application ports
Sales/Purchases ─────> Inventory application ports (عند إضافة الحركات مستقبلًا)
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

## 6. حالة النقل والاستثناءات الانتقالية

اكتمل في 22 أغسطس 2026 نقل إنشاء وعكس `JournalEntry/JournalLine` إلى `PostingEngine`، واستبدلت عقود التخصيص `targetJournalLineId` بـ`ReceivableItemId/PayableItemId`، ونقل CRUD والحساب الضريبي إلى وحدة `Tax`، ونقل CRUD الصناديق وطرق الدفع وسياسة أداة الحركة إلى وحدة `Treasury`. أضيف `Data Import` كسياق داعم يملك `DataImportBatch` فقط ويستدعي منافذ المالكين لإنشاء بياناتهم؛ لا يكتب Ledger ولا يخزن الملف. وفي 24 أغسطس بدأت رحلة Inventory بسياق مستقل يملك `Warehouse` دون إدخال أصناف أو أرصدة أو أثر محاسبي في الشريحة الأولى. يبقى رابط سطر الذمة على الفاتورة أثرًا داخليًا لـCore Accounting ولا يعبر عقدًا عامًا. التفاصيل في [عناصر الذمم وعقد التسوية](AR_AP_SETTLEMENT_ITEMS_AR.md) و[ملكية Tax](TAX_CONTEXT_OWNERSHIP_AR.md) و[ملكية Treasury](TREASURY_CONTEXT_OWNERSHIP_AR.md) و[سياق الاستيراد](DATA_IMPORT_CONTEXT_AR.md) و[أساس Inventory](INVENTORY_CONTEXT_FOUNDATION_AR.md).

الاستثناءات التالية ما زالت موجودة ولا تعد نمطًا مسموحًا للنسخ:

- `CompanyService` يفحص جداول عدة Contexts مباشرة عند تعطيل العملات.
- Onboarding يكتب مباشرة في بعض جداول IAM/Tenant/Accounting Setup؛ أصبحت طرق الدفع تمر عبر Treasury setup port.

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
