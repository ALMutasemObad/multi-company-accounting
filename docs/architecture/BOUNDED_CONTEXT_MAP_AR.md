---
title: "Bounded Context Map"
status: "accepted target architecture"
version: "2.8"
last_updated: "2026-08-28"
---

# خريطة الـBounded Contexts وملكية البيانات

## 1. الهدف

تحدد هذه الوثيقة المالك المنطقي لكل مفهوم، واتجاهات الاعتماد المسموحة. هي Target Architecture تدريجية؛ بعض الكود الحالي لا يزال مخالفًا لها كما هو موثق في تقرير التدقيق.

## 2. قاعدة الملكية

لكل Aggregate وجدول مالك كتابة واحد. وجود Foreign Key أو Prisma relation لا يمنح Context آخر حق تعديل الكيان مباشرة.

## 3. السياقات والملكية المستهدفة

| Context | المسؤولية | ملكية الكتابة المستهدفة | ملاحظات |
|---|---|---|---|
| Identity & Access | الهوية والجلسات والأدوار والصلاحيات واستعادة كلمة المرور | `User`, `Session`, `PasswordResetRequest`, `UserCompany`, `Role`, `Permission`, `RolePermission`, `UserCompanyRole` | يقدم منافذ الهوية؛ `ActorContext` نوع محايد في Application Kernel، وبريد الاستعادة أثر Outbox |
| Tenant & Company Configuration | المؤسسة والشركة والعملات والإعدادات | `Organization`, `Company`, `Currency`, `CompanyCurrency`, `CompanyExchangeRate` | Organization تجمع الشركات فقط حاليًا؛ لا أدوار مجموعة أو تجميع مالي. فحص الاستخدام عبر Ports، لا عبر معرفة كل جداول المستندات |
| Registration & Onboarding | دورة التسجيل والتحقق والتنسيق | `RegistrationRequest`, `RegistrationEvent` | Process Manager؛ لا يملك User/Company/Account |
| Core Accounting | السنة والفترة والدليل والمستند والدفتر والترحيل وحسابات فروقات العملة | `FiscalYear`, `FiscalPeriod`, `DocumentSequence`, `AccountingDocument`, `JournalEntry`, `JournalLine`, `AccountType`, `Account`, `CostCenter` | المالك الوحيد للـPosting Engine ويحل حسابي ربح/خسارة فرق العملة عبر منفذ صغير |
| Sales & Accounts Receivable | العميل والفاتورة والذمة وسياسة تسوية التحصيل | `Customer`, `CustomerAddress`, `SalesInvoice`, `SalesInvoiceLine`, `ReceivableItem` | يكشف `ReceivableSettlementPort` ولا ينشئ Journal Lines مباشرة |
| Purchases & Accounts Payable | المورد والفاتورة والذمة وسياسة تسوية السداد | `Supplier`, `SupplierAddress`, `PurchaseInvoice`, `PurchaseInvoiceLine`, `PayableItem` | يكشف `PayableSettlementPort` ولا ينشئ Journal Lines مباشرة |
| Treasury | النقد والبنوك وطرق الدفع وحركات القبض والصرف وتخصيصاتها ولقطات التسوية واستيراد كشوف البنك والمطابقة 1:1 | `CashBankAccount`, `PaymentMethod`, `Receipt`, `ReceiptAllocation`, `Payment`, `PaymentAllocation`, `BankStatementImport`, `BankStatementLine`, `BankReconciliationSession`, `BankReconciliationMatch` | تستخدم التخصيصات منافذ AR/AP و`PostingEngine`؛ وتقرأ المطابقة الحركات المرحلة عبر Query Port فقط ولا تكتب Ledger |
| Inventory | المستودعات والكتالوج ودفتر الحركة الكمي والقيمي والأرصدة وتقييم المتوسط | `Warehouse`, `UnitOfMeasure`, `InventoryItem`, `InventoryMovementSequence`, `InventoryMovement`, `InventoryMovementLine`, `InventoryBalance`, `InventoryValuationInitialization` | يكشف منفذي اختيار الفاتورة وتطبيق أثرها؛ يعيد حقائق تقييم للفواتير، وينشئ رأس `INVENTORY_ADJUSTMENT` للحركة اليدوية ثم يفوض إنشاء/عكس أسطر Ledger إلى `PostingEngine` |
| Point of Sale | تنسيق البيع النقدي الحضوري وربط نتيجة الـCheckout | `PosSale` فقط | Process Manager؛ لا يملك بنودًا أو مبالغ أو فاتورة أو حركة مخزون/نقد أو قيدًا، ويستدعي منافذ Sales وTreasury الحالية |
| Approvals | تنسيق طلبات وقرارات Maker/Checker المشتركة | `ApprovalRequest`, `ApprovalDecision` | يربط الموضوع ونسخته وبصمته فقط؛ يطبق المالك انتقال الموضوع عبر `ApprovalSubjectPort` ولا يملك حالته أو أثره المالي |
| CRM / Business Development | الاستقطاب قبل العميل، التأهيل، فرصة البيع، مراحلها، وتتبعاتها التجارية | `CrmLead`, `CrmOpportunity`, `CrmActivity` | سياق مستهدف وفق ADR-014؛ يحول Lead إلى Customer عبر Sales Port ولا يملك Customer أو الفاتورة أو المشروع أو أي حقيقة مالية |
| Professional Services & Projects | القضايا والتكليفات والمشاريع المهنية، فرقها ووصولها، خطة المراحل والمهام، الوقت المعتمد، والعقود والأسعار ومصدر الفوترة | `ProfessionalProject`, `ProfessionalProjectMember`, `ProfessionalProjectAccessGrant`, `ProfessionalProjectStage`, `ProfessionalProjectTask`, `ProfessionalTaskDependency`, `ProfessionalTimeEntry`, `ProfessionalTimesheet`, `ProfessionalTimesheetSubmission`, `ProfessionalServiceContract`, `ProfessionalServiceRate`, `ProfessionalBillingRun`, `ProfessionalBillingSourceLine` | يملك الجدار الأخلاقي وميزانية دقائق المشروع والخطة؛ يقرأ العميل والفاتورة من Sales والشخص من Identity والموظف من HR والعملة من Tenant عبر Ports، ولا يملك المصروف أو حقائق الفاتورة أو الذمة أو الضريبة أو القيد |
| Human Resources | الهيكل التنظيمي وهوية الموظف وحالة العمل والعقد غير المالي | `HrDepartment`, `HrPosition`, `Employee`, `EmploymentContract` | الموظف مستقل عن `User` ويرتبط اختياريًا بعضوية الشركة عبر Identity Port؛ لا يملك رواتب أو بيانات بنكية أو قرار موافقة أو وقت مشروع |
| Tax | معدلات الضرائب وربط حساباتها والحساب والتقريب | `TaxRate` | يكشف `TaxQuotePort` للمبيعات والمشتريات ويملك النسخ المتفائلة |
| Printing & Document Output | اللقطات التاريخية والتوليد | `DocumentPrintArchive` | يقرأ عبر Document Snapshot Port |
| Reporting | التقارير والقوائم وRead Models | لا يملك حقائق مالية تشغيلية | قراءة فقط، ويمكنه امتلاك projections مستقبلًا |
| Platform Operations | مؤشرات تبني وصحة المنصة العابرة للشركات للشركة المطوّرة | لا يملك جداول أعمال | قراءة تجميعية فقط عبر Query Ports، وتفويض مشغّل منصة مستقل عن أدوار الشركات؛ لا يعرض بيانات أفراد أو تفاصيل مالية |
| Data Import | تنسيق القوالب والمعاينة والاعتماد الجماعي | `DataImportBatch` فقط | Process Manager؛ يستدعي منافذ المالكين ولا يخزن الملف أو يرحّل الفواتير |
| Audit | سجل الأعمال والامتثال | `AuditLog` | Append-only، وليس Event Bus |
| Security Monitoring | أحداث المخاطر والإقرار | `SecurityEvent` | يمكنه إصدار تنبيه Integration بعد حفظ الحدث |
| Application Infrastructure | Idempotency وOutbox والتسلسلات التقنية والتشغيل والحماية المشتركة من إساءة الاستخدام | `IdempotencyRecord`, `OutboxEvent`, `MasterDataCodeSequence`, `RateLimitCounter` | ليست Bounded Context أعمال؛ تخزن HMAC هوية بسر تشغيل مستقل لا IP أو بريدًا أو رمزًا خامًا، وتوفر حجز الرمز الذري للكيانات المرجعية ولا تملك تلك الكيانات |

## 4. اتجاهات الاعتماد المسموحة

```text
Registration/Onboarding
    ├──> Identity & Access ports
    ├──> Tenant Configuration ports
    ├──> Accounting Setup ports
    ├──> Treasury Setup port
    └──> Security append port

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
CRM ─────────────────> Sales customer query/provisioning ports
CRM ─────────────────> Human Resources workforce and Tenant currency query ports
Professional Projects ──> Sales customer query port and Identity people query port
Professional Projects ──> Human Resources employee query port
Professional Projects ──> Tenant currency query port and Sales professional-billing application/query port
Human Resources ────────> Identity membership query port
Workforce Access workflow ──> Human Resources employee-account port + Identity account port
All operational contexts ──> Audit append port
Authentication/Identity ───> Security append port

Reporting <────────── read/query ports or dedicated read models
Platform Operations <── aggregate query ports + Identity operator query port
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

لا ينشأ Outbox Event لمجرد احتمال وجود تنبيه مستقبلي. يلزم مستهلك معروف وعقد حدث versioned وسياسة Claim/Retry/Dead-letter/Retention قبل كتابة الحدث؛ وإلا يقتصر التغيير على حالة المالك و`AuditLog` داخل المعاملة.

## 6. حالة النقل والاستثناءات الانتقالية

اكتمل في 22 أغسطس 2026 نقل إنشاء وعكس `JournalEntry/JournalLine` إلى `PostingEngine`، واستبدلت عقود التخصيص `targetJournalLineId` بـ`ReceivableItemId/PayableItemId`، ونقل CRUD والحساب الضريبي إلى وحدة `Tax`، ونقل CRUD الصناديق وطرق الدفع وسياسة أداة الحركة إلى وحدة `Treasury`. أضيف `Data Import` كسياق داعم يملك `DataImportBatch` فقط ويستدعي منافذ المالكين لإنشاء بياناتهم؛ لا يكتب Ledger ولا يخزن الملف. وفي 24 و25 أغسطس بدأت رحلة Inventory بسياق مستقل يملك `Warehouse`، ثم توسعت إلى الكتالوج وربط تأليف الفواتير ودفتر حركة immutable، ثم رُبط ترحيل وعكس فواتير الأصناف بحركة ذرية عبر `InventoryInvoiceStockPort` مع تفرد مصدر ومنع المخزون السالب. وفي 26 أغسطس أضيف تقييم المتوسط المرجح المتحرك وقيمة الرصيد والتكلفة التاريخية للعكس والمرتجعات؛ يعيد Inventory حقائق التقييم للفواتير، وتبني Sales/Purchases قيود المخزون وCOGS التي يكتبها `PostingEngine`. وأغلقت لاحقًا فجوة الحركة اليدوية: ينشئ Inventory رأس `INVENTORY_ADJUSTMENT` ويطلب من `PostingEngine` قيد الزيادة أو النقص أو عكسه التاريخي، من دون كتابة مباشرة لأسطر Ledger. وفي 27 أغسطس أضيفت المطابقة البنكية داخل Treasury مع واجهة إطلاق تدريجي: يملك الوارد وخطوطه والجلسة وسجل الربط، ويقرأ الحركات المرحلة من Core Accounting عبر `ReconciliationLedgerQueryPort` من دون كتابة Ledger؛ إنشاء الحركة المفقودة يبقى أمرًا منفصلًا في خدمات المستندات الحالية و`PostingEngine`. لا توجد أذونات استلام وتسليم مستقلة؛ الفاتورة المرحلة هي مستند الكمية والقيمة الانتقالي. يبقى رابط سطر الذمة على الفاتورة أثرًا داخليًا لـCore Accounting ولا يعبر عقدًا عامًا. التفاصيل في [عناصر الذمم وعقد التسوية](AR_AP_SETTLEMENT_ITEMS_AR.md) و[ملكية Tax](TAX_CONTEXT_OWNERSHIP_AR.md) و[ملكية Treasury](TREASURY_CONTEXT_OWNERSHIP_AR.md) و[واجهة المطابقة](BANK_RECONCILIATION_UI_ROLLOUT_AR.md) و[سياق الاستيراد](DATA_IMPORT_CONTEXT_AR.md) و[أساس Inventory](INVENTORY_CONTEXT_FOUNDATION_AR.md).

وفي 27 أغسطس اعتمدت أول شريحة POS كمنسق رفيع لبيع نقدي وفق [ADR-004](ADR-004-pos-cash-sale-orchestration.md): يملك `PosSale` رابط النتيجة فقط، ويفوض الفاتورة والمخزون والتحصيل والترحيل إلى المالكين الحاليين داخل معاملة واحدة، ولا يخزن بنودًا أو مبالغ أو يكتب Ledger.

ثم أضيف سياق Approvals وفق [ADR-005](ADR-005-shared-approval-engine.md): يملك طلب الموافقة والقرار فقط، ويستدعي `FinancialCloseApprovalAdapter` لتغيير تشغيل الإقفال داخل المعاملة. لا يقرأ أو يكتب Ledger أو يكرر حزمة الإقفال؛ يخزن بصمتها ونسخة الموضوع فقط، وتفرض الشريحة الأولى Checker مستقلًا.

وأضيف سياق Professional Services & Projects وفق [ADR-006](ADR-006-professional-services-projects-priority.md): يملك المشروع المهني وعضويته وسجل الوقت الشخصي الخام، ويربط القضية أو التكليف بعميل Sales وبأعضاء Identity عبر منفذين يملكهما السياقان المصدران. لا يكتب في العميل أو المستخدم أو المخزون أو الخزينة أو Ledger.

ثم أضيف سياق Human Resources وفق [ADR-007](ADR-007-human-resources-foundation.md): يملك الأقسام والمناصب والموظف والعقد المؤرخ غير المالي. يظل `Employee` هوية عمل مستقلة عن `User`، ويتحقق من الرابط الاختياري بعضوية الشركة عبر `HrIdentityPort` دون تحديث Identity. لا يكتب HR في المشاريع أو الموافقات أو الفواتير أو المخزون أو الخزينة أو Ledger، وتبقى الرواتب والإجازات والبيانات الحساسة خارج الشريحة.

وفي 28 أغسطس اعتمد [ADR-012](ADR-012-employee-first-user-provisioning.md) اتجاه إنشاء حساب الشركة من موظف موجود. ينسق `WorkforceAccessService` بين منفذ HR ومنفذ Identity داخل معاملة واحدة، ولا يملك جدولًا. أزيل اختيار المستخدم من أوامر إنشاء/تعديل الموظف، وأصبح `/users` يتطلب موظفًا مؤهلًا، مع مسار انتقالي لربط حسابات التأسيس والحسابات القديمة.

ثم أضيفت فترة Timesheet الأسبوعية وفق [ADR-008](ADR-008-professional-timesheets-approval.md): يملك سياق المشاريع حالة الفترة ومحاولات إرسالها immutable، ويقرأ الموظف النشط عبر HR port، ويرسل `PROFESSIONAL_TIMESHEET` إلى Approvals. يحتفظ Approvals بالطلب والقرار وحدهما، ولا تنسخ الفترة قرار Checker أو حقائق الوقت الخام.

ثم أضيفت أول شريحة فوترة خدمات وفق [ADR-009](ADR-009-professional-service-billing.md): يملك السياق عقد الخدمة وسعر الساعة المؤرخ ومرجع مصدر الوقت والسعر المستخدم، ويستدعي `ProfessionalBillingSalesPort` لإنشاء وترحيل فاتورة Sales عادية داخل المعاملة نفسها. لا ينسخ رقم الفاتورة أو إجماليها أو ضريبتها أو الذمة أو القيد؛ تُقرأ هذه الحقائق من Sales عبر Query Port، ويبقى `PostingEngine` كاتب Ledger الوحيد.

ثم نُفذت E1 محليًا لتخطيط المشاريع وفق [ADR-010](ADR-010-professional-project-planning.md): يظل `ProfessionalProject` جذر الخطة ويفصل `planningVersion` عن نسخة حقول المشروع، ويملك المراحل والمهام واعتمادياتها وميزانية الدقائق. يرتبط الوقت اختياريًا بالمهمة، وتبقى الفعلية مشتقة من `ProfessionalTimeEntry` بلا عمود مجموع موازٍ. لا تضيف الشريحة اتصالًا بـPurchases أو Approvals أو Ledger ولا Outbox بلا مستهلك. تبقى مصروفات E2 بلا مالك منفذ وتحتاج قرارًا يفصل مطالبة الموظف عن فاتورة المورد والدفع وإعادة الفوترة.

ثم نُفذ الجدار الأخلاقي F1 وفق [ADR-011](ADR-011-professional-ethical-wall.md): يملك Professional Projects وضع وصول القضية ومنحها، وتبقى صلاحية RBAC شرطًا مستقلًا. تستبعد القضية المقيدة من القوائم والمجاميع وتعيد 404 لغير المسموح، ولا تغير المنحة حقائق المشروع أو الفوترة أو Ledger. يظل فحص تعارض المصالح F2 خارج النطاق وشرطًا قبل إنشاء قضية من أي مسار استقبال مستقبلي.

واعتمد [ADR-014](ADR-014-crm-business-development-priority.md) سياق `CRM / Business Development` كهدف المرحلة التالية: يملك Lead وOpportunity وActivity قبل العميل، ويحول عبر منفذ Sales من دون كتابة Customer مباشرة أو نسخ حقائق الفاتورة والذمة. لا ينشئ CRM الأول مشروعًا أو قضية؛ يلزم F2 قبل إضافة هذا الربط لشركات المحاماة.

وفي دفعة التثبيت السابقة لـCRM نُقل CRUD العميل وعناوينه من وحدة Receipts إلى Sales،
وأصبح Data Import يستهلك `CustomerImportPort`. يكشف Sales كذلك
`CrmCustomerQueryPort/CrmCustomerProvisioningPort` داخل `TransactionClient` المستدعي؛
وبذلك لا يحتاج CRM إلى Prisma أو إلى استيراد خدمة التطبيق الخاصة بالعميل.

وفي دفعة السداد المعماري اللاحقة أزيلت الاستثناءات الانتقالية عالية المخاطر:

- أصبح `CompanyService` يسأل منافذ Core Accounting وSales وPurchases وTreasury عن
  استعمال العملة بدل قراءة جداولها مباشرة.
- أصبح تجهيز الشركة والتسجيل Process Managers يعتمدان منافذ Tenant وIdentity وAccounting
  وTreasury وSecurity ولا يكتبان حقائق المالكين مباشرة.
- أصبح `AuditLog` append-only خلف حد Audit و`SecurityEvent` خلف حد Security، وانتقلت
  قراءة المستخدمين لكل منهما إلى Identity Query Ports.
- انتقلت قراءات الحسابات المرجعية والطباعة وتجميع لقطاتها إلى Query Adapters مملوكة
  للجهة المصدر، وأضيفت حواجز آلية تمنع عودة الكتابات والقراءات المباشرة المحظورة.

لا توجد حاليًا قائمة استثناءات ملكية مسموح بنسخها؛ أي استثناء جديد يحتاج ADR صريحًا.

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
| `CrmLead` | حالة الاستقطاب والتأهيل والتحويل مرة واحدة إلى مرجع Customer من دون امتلاك العميل |
| `CrmOpportunity` | مرحلة فرصة البيع وقيمتها المتوقعة لكل عملة واحتمالها ونتيجتها التجارية |
| `ProfessionalProject` | هوية العمل والعميل المرجعي والنوع ونموذج الفوترة والحالة والتواريخ والفريق، ومراجعة الخطة `planningVersion` وتماسك مراحلها ومهامها واعتمادياتها والوقت المنسوب إليها |
| `ProfessionalTimesheet` | أسبوع الموظف، ثبات إدخالاته أثناء المراجعة وبعد الاعتماد، وتسلسل لقطات الإرسال |
| `ProfessionalServiceContract` | عملة وشروط السداد وفترة سريان تجارية واحدة غير متداخلة لكل مشروع وقت ومواد |
| `ProfessionalBillingRun` | استخدام وقت معتمد مرة واحدة وربطه بفاتورة Sales مع تثبيت مصدر الوقت والسعر دون نسخ حقائقها المالية |
| `Employee` | الهوية الوظيفية داخل الشركة، الإسناد التنظيمي، سلسلة المدير، حالة العمل والعقد النشط الواحد |
| `ChartOfAccounts`/`Account` | صلاحية الترحيل والبنية الهرمية |

لا يشترط أن تتحول جميعها إلى Classes كبيرة؛ المطلوب أن تكون invariants والملكية ومداخل التغيير واضحة ومختبرة.
