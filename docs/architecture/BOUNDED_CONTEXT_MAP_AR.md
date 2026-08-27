---
title: "Bounded Context Map"
status: "accepted target architecture"
version: "2.0"
last_updated: "2026-08-27"
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
| Core Accounting | السنة والفترة والدليل والمستند والدفتر والترحيل وحسابات فروقات العملة | `FiscalYear`, `FiscalPeriod`, `DocumentSequence`, `AccountingDocument`, `JournalEntry`, `JournalLine`, `AccountType`, `Account`, `CostCenter` | المالك الوحيد للـPosting Engine ويحل حسابي ربح/خسارة فرق العملة عبر منفذ صغير |
| Sales & Accounts Receivable | العميل والفاتورة والذمة وسياسة تسوية التحصيل | `Customer`, `CustomerAddress`, `SalesInvoice`, `SalesInvoiceLine`, `ReceivableItem` | يكشف `ReceivableSettlementPort` ولا ينشئ Journal Lines مباشرة |
| Purchases & Accounts Payable | المورد والفاتورة والذمة وسياسة تسوية السداد | `Supplier`, `SupplierAddress`, `PurchaseInvoice`, `PurchaseInvoiceLine`, `PayableItem` | يكشف `PayableSettlementPort` ولا ينشئ Journal Lines مباشرة |
| Treasury | النقد والبنوك وطرق الدفع وحركات القبض والصرف وتخصيصاتها ولقطات التسوية واستيراد كشوف البنك والمطابقة 1:1 | `CashBankAccount`, `PaymentMethod`, `Receipt`, `ReceiptAllocation`, `Payment`, `PaymentAllocation`, `BankStatementImport`, `BankStatementLine`, `BankReconciliationSession`, `BankReconciliationMatch` | تستخدم التخصيصات منافذ AR/AP و`PostingEngine`؛ وتقرأ المطابقة الحركات المرحلة عبر Query Port فقط ولا تكتب Ledger |
| Inventory | المستودعات والكتالوج ودفتر الحركة الكمي والقيمي والأرصدة وتقييم المتوسط | `Warehouse`, `UnitOfMeasure`, `InventoryItem`, `InventoryMovementSequence`, `InventoryMovement`, `InventoryMovementLine`, `InventoryBalance`, `InventoryValuationInitialization` | يكشف منفذي اختيار الفاتورة وتطبيق أثرها؛ يعيد حقائق تقييم للفواتير، وينشئ رأس `INVENTORY_ADJUSTMENT` للحركة اليدوية ثم يفوض إنشاء/عكس أسطر Ledger إلى `PostingEngine` |
| Point of Sale | تنسيق البيع النقدي الحضوري وربط نتيجة الـCheckout | `PosSale` فقط | Process Manager؛ لا يملك بنودًا أو مبالغ أو فاتورة أو حركة مخزون/نقد أو قيدًا، ويستدعي منافذ Sales وTreasury الحالية |
| Approvals | تنسيق طلبات وقرارات Maker/Checker المشتركة | `ApprovalRequest`, `ApprovalDecision` | يربط الموضوع ونسخته وبصمته فقط؛ يطبق المالك انتقال الموضوع عبر `ApprovalSubjectPort` ولا يملك حالته أو أثره المالي |
| Professional Services & Projects | القضايا والتكليفات والمشاريع المهنية، فرقها، والوقت الخام | `ProfessionalProject`, `ProfessionalProjectMember`, `ProfessionalTimeEntry` | يقرأ العميل من Sales والشخص من Identity عبر Ports؛ لا يملك فاتورة أو تسعيرًا أو قرار موافقة أو وقتًا معتمدًا أو قيدًا |
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
Treasury reconciliation ──> Core Accounting ledger query port (read-only)
Registration/Onboarding ──> Treasury setup port
Sales/Purchases ──────> Tax Configuration query port
Data Import ──────────> Sales/AR, Purchases/AP application ports
Sales/Purchases ─────> Inventory catalog and invoice-stock application ports
POS ─────────────────> Sales cash-checkout and Treasury receipt application ports
Approvals ───────────> owning context approval-subject application ports
Professional Projects ──> Sales customer query port and Identity people query port
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
- التحقق من مستودع وصنف نشطين ودقة كمية وحدة القياس عند حفظ الفاتورة.
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

اكتمل في 22 أغسطس 2026 نقل إنشاء وعكس `JournalEntry/JournalLine` إلى `PostingEngine`، واستبدلت عقود التخصيص `targetJournalLineId` بـ`ReceivableItemId/PayableItemId`، ونقل CRUD والحساب الضريبي إلى وحدة `Tax`، ونقل CRUD الصناديق وطرق الدفع وسياسة أداة الحركة إلى وحدة `Treasury`. أضيف `Data Import` كسياق داعم يملك `DataImportBatch` فقط ويستدعي منافذ المالكين لإنشاء بياناتهم؛ لا يكتب Ledger ولا يخزن الملف. وفي 24 و25 أغسطس بدأت رحلة Inventory بسياق مستقل يملك `Warehouse`، ثم توسعت إلى الكتالوج وربط تأليف الفواتير ودفتر حركة immutable، ثم رُبط ترحيل وعكس فواتير الأصناف بحركة ذرية عبر `InventoryInvoiceStockPort` مع تفرد مصدر ومنع المخزون السالب. وفي 26 أغسطس أضيف تقييم المتوسط المرجح المتحرك وقيمة الرصيد والتكلفة التاريخية للعكس والمرتجعات؛ يعيد Inventory حقائق التقييم للفواتير، وتبني Sales/Purchases قيود المخزون وCOGS التي يكتبها `PostingEngine`. وأغلقت لاحقًا فجوة الحركة اليدوية: ينشئ Inventory رأس `INVENTORY_ADJUSTMENT` ويطلب من `PostingEngine` قيد الزيادة أو النقص أو عكسه التاريخي، من دون كتابة مباشرة لأسطر Ledger. وفي 27 أغسطس أضيف Backend المطابقة البنكية داخل Treasury: يملك وارد الكشف وخطوطه والجلسة وسجل الربط، ويقرأ الحركات المرحلة من Core Accounting عبر `ReconciliationLedgerQueryPort` من دون كتابة Ledger؛ إنشاء الحركة المفقودة يبقى أمرًا منفصلًا في خدمات المستندات الحالية و`PostingEngine`. لا توجد بعد واجهة مطابقة أو أذونات استلام وتسليم مستقلة؛ الفاتورة المرحلة هي مستند الكمية والقيمة الانتقالي. يبقى رابط سطر الذمة على الفاتورة أثرًا داخليًا لـCore Accounting ولا يعبر عقدًا عامًا. التفاصيل في [عناصر الذمم وعقد التسوية](AR_AP_SETTLEMENT_ITEMS_AR.md) و[ملكية Tax](TAX_CONTEXT_OWNERSHIP_AR.md) و[ملكية Treasury](TREASURY_CONTEXT_OWNERSHIP_AR.md) و[Backend المطابقة البنكية](BANK_RECONCILIATION_BACKEND_AR.md) و[سياق الاستيراد](DATA_IMPORT_CONTEXT_AR.md) و[أساس Inventory](INVENTORY_CONTEXT_FOUNDATION_AR.md).

وفي 27 أغسطس اعتمدت أول شريحة POS كمنسق رفيع لبيع نقدي وفق [ADR-004](ADR-004-pos-cash-sale-orchestration.md): يملك `PosSale` رابط النتيجة فقط، ويفوض الفاتورة والمخزون والتحصيل والترحيل إلى المالكين الحاليين داخل معاملة واحدة، ولا يخزن بنودًا أو مبالغ أو يكتب Ledger.

ثم أضيف سياق Approvals وفق [ADR-005](ADR-005-shared-approval-engine.md): يملك طلب الموافقة والقرار فقط، ويستدعي `FinancialCloseApprovalAdapter` لتغيير تشغيل الإقفال داخل المعاملة. لا يقرأ أو يكتب Ledger أو يكرر حزمة الإقفال؛ يخزن بصمتها ونسخة الموضوع فقط، وتفرض الشريحة الأولى Checker مستقلًا.

وأضيف سياق Professional Services & Projects وفق [ADR-006](ADR-006-professional-services-projects-priority.md): يملك المشروع المهني وعضويته وسجل الوقت الشخصي الخام، ويربط القضية أو التكليف بعميل Sales وبأعضاء Identity عبر منفذين يملكهـما السياقان المصدران. لا يكتب في العميل أو المستخدم أو الفاتورة أو المخزون أو الخزينة أو Ledger. يبقى اعتماد الوقت والفوترة وHR وخصائص المكتب القانوني مراحل لاحقة مستقلة موثقة في [خارطة الخدمات المهنية](PROFESSIONAL_SERVICES_HR_PROJECTS_ROADMAP_AR.md).

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
| `ApprovalRequest` | طلبًا نشطًا واحدًا لكل موضوع، وفصل Maker/Checker، وقرارًا نهائيًا immutable |
| `ProfessionalProject` | هوية العمل والعميل المرجعي والنوع ونموذج الفوترة والحالة والتواريخ والفريق والوقت المنسوب إليه |
| `ChartOfAccounts`/`Account` | صلاحية الترحيل والبنية الهرمية |

لا يشترط أن تتحول جميعها إلى Classes كبيرة؛ المطلوب أن تكون invariants والملكية ومداخل التغيير واضحة ومختبرة.
