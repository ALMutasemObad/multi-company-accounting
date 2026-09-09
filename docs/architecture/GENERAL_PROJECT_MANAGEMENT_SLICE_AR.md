---
title: "General Project Management — Executable Slices"
status: "planned; gated after company-profile-bp1"
version: "1.0"
date: "2026-09-09"
owner: "General Project Delivery"
related:
  - "ADR-021-general-project-delivery-context.md"
  - "ADR-018-business-profile-and-progressive-compliance.md"
  - "HR_FOUNDATION_SLICE_AR.md"
  - "APPROVAL_ENGINE_FINANCIAL_CLOSE_SLICE_AR.md"
  - "EMPLOYEE_EXPENSE_CLAIMS_SLICE_AR.md"
---

# خطة شرائح إدارة المشاريع العامة

## 1. الهدف وحد البرنامج

تقدم الخطة إدارة مشروع عام من قائمة مستقلة إلى مشروع ومراحل ومهام واعتماديات
ومسؤولين ومتابعين وتعليقات، من دون توسيع `Professional Project Delivery` أو نسخ
حقائق HR/Sales/Approvals/Employee Expenses.

الخطة **ليست تنفيذًا** ولا تعدل Schema أو OpenAPI أو الكود. يبدأ التنفيذ فقط بعد:

1. دمج `company-profile-bp1` في baseline المهمة الجديدة.
2. توافر `CompanyProfile` و`CompanyRegistration` و`CompanyTaxRegistration`
   و`CompanyAddress` وواجهتي profile/compliance.
3. إنشاء worktree جديدة من `origin/main` المتحقق منه، وتخصيص نطاق ملفات وترحيل لا
   يتداخل مع مهمة أخرى.

لا تتطلب الرحلة حالة profile readiness معينة؛ `ACTION_RECOMMENDED` لا يمنع المشروع،
والحسابات القديمة grandfathered. بوابة ملف المنشأة ترتيب دمج فقط.

## 2. حد الملكية التنفيذي

### ما يكتبه السياق

| الكيان | الغرض |
|---|---|
| `GeneralProject` | الجذر، الرمز، الحالة، الأولوية، التواريخ، العميل الاختياري، `version/planVersion` |
| `GeneralProjectMember` | موظفو HR المسندون للمشروع وأدوارهم وتاريخ الإسناد |
| `GeneralProjectPhase` | تقسيم الخطة وترتيبها وحالتها وتواريخها |
| `GeneralProjectTask` | العمل التنفيذي والأولوية والتواريخ والحالة |
| `GeneralTaskAssignment` | المسؤولون والمساهمون المتعددون في المهمة |
| `GeneralTaskDependency` | اعتماد Finish-to-Start داخل المشروع نفسه |
| `GeneralProjectFollower` | متابعة ذاتية لمستخدم الشركة من دون منح وصول |
| `GeneralProjectComment` | تعليق نصي append-only على المشروع أو مهمة منه |

كل جدول يحمل `companyId`. لا تستخدم علاقات polymorphic عامة، ولا JSON لقوائم
المسؤولين أو الاعتماديات، ولا أعمدة إجماليات مشتقة.

### ما لا يكتبه السياق

- `professional_projects` أو أي جدول يبدأ بـ`professional_`.
- `Customer`, `Employee`, `User/UserCompany` أو حقول ملف المنشأة.
- `ApprovalRequest/ApprovalDecision` أو `EmployeeExpenseClaim/Line`.
- `SalesInvoice/ReceivableItem/TaxRate` أو `Payment/PayableItem`.
- `AccountingDocument/JournalEntry/JournalLine`.
- `AuditLog` إلا من خلال Audit append port؛ ولا يستخدم Audit كتعليق أو Outbox.

## 3. قاموس البيانات والقواعد

### المشروع

- ينشئ الخادم `code=GPR-######` ذريًا تحت نوع تسلسل `GENERAL_PROJECT`، ويكون
  `readOnly` وغير قابل للتعديل.
- الاسم العربي مطلوب، والإنجليزي والوصف اختياريان.
- `customerId` اختياري؛ يتحقق من Sales داخل الشركة ولا تنسخ بيانات العميل.
- الحالات: `DRAFT`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `CANCELLED`.
- الأولويات: `LOW`, `NORMAL`, `HIGH`, `URGENT`.
- التواريخ Date-only بصيغة `YYYY-MM-DD` ودلالتها تقويم المنشأة. لا يحولها العميل
  عبر `new Date()` بطريقة تغير اليوم عند اختلاف المنطقة الزمنية.
- `version` للرأس والحالة، و`planVersion` للبنية. لا تزيد المتابعة أو التعليق
  `planVersion`.

### الفريق والإسناد

- عضو المشروع Employee من الشركة نفسها ودوره `MANAGER` أو `CONTRIBUTOR`.
- ينشئ صاحب الأمر الأول عضوًا مديرًا إذا كان Employee نشطًا مرتبطًا بحسابه؛ وإلا
  يختار مديرًا مؤهلًا ضمن أمر الإنشاء. لا ينشأ Employee أو User ضمن المعاملة.
- لا يلغى آخر مدير نشط، ولا عضو مسؤول عن مهمة غير نهائية.
- إسناد المهمة متعدد بدور `RESPONSIBLE` أو `CONTRIBUTOR`. لا تبدأ مهمة بلا مسؤول
  نشط واحد على الأقل.
- انتهاء موظف لاحقًا لا يحذف التاريخ؛ تمنع إسنادات جديدة ويظهر المرجع «غير نشط».

### المراحل والمهام

- يولد الخادم `sequence` تحت قفل المشروع/المرحلة؛ لا Drag-and-drop ولا إعادة ترقيم
  في البداية.
- المرحلة: `PLANNED/IN_PROGRESS/COMPLETED/CANCELLED`.
- المهمة: `TODO/IN_PROGRESS/BLOCKED/COMPLETED/CANCELLED`.
- `BLOCKED` حالة تشغيلية يضعها المستخدم بسبب؛ أما الحجب الناتج عن اعتمادية غير
  مكتملة فيعرض أيضًا كقيمة مشتقة `dependencyBlocked=true` ولا يغير الحالة صامتًا.
- إكمال المرحلة يتطلب مهام نهائية، وإكمال المشروع يتطلب مراحل ومهام نهائية.
- الإلغاء منطقي ومسبب؛ لا حذف صلب للخطة بعد استخدامها.

### الاعتماديات

- زوج فريد `predecessorTaskId/successorTaskId` داخل المشروع والشركة نفسيهما.
- منع self-reference والتكرار والدورة، مع إعادة بناء DAG بعد قفل الجذر.
- السابقة الملغاة لا تعد مكتملة. يزيل المدير الرابط بسبب أو يعيد تخطيط المهمة.
- إزالة الرابط منطقية وتحفظ الفاعل والوقت والسبب والنسخة.

### المتابعة والتعليقات

- المتابعة ذاتية لمستخدم الشركة، وواحدة فعالة لكل `(companyId, projectId, userId)`.
- لا يضيف المدير متابعًا نيابة عن غيره في أول شريحة تعاون، ولا تمنح المتابعة إذنًا.
- التعليق plain text بطول 1–2000، ومشروعه مطلوب و`taskId` اختياري ومقيد بالمشروع.
- لا تعديل/حذف/مرفقات/mentions في البداية. أي Redaction إداري يحتاج سياسة مستقلة
  بسبب أثر التدقيق والخصوصية.
- لا إشعارات أو بريد في شريحة التعاون؛ يستفيد المتابع من مرشح القائمة فقط حتى يوجد
  مستهلك Outbox معتمد.

## 4. خطة الشرائح الصغيرة

| الترتيب | الشريحة | الناتج القابل للإغلاق | الاعتمادات |
|---:|---|---|---|
| GPM-1 | سجل المشروع العام | module/permissions، قائمة/إنشاء/تفاصيل/تعديل/حالة، رمز `GPR-`، عميل اختياري، مدير وعضوية مشروع | company-profile-bp1 + HR؛ Sales اختياري |
| GPM-2 | خطة العمل والمسؤولون | مراحل ومهام وأولوية وتواريخ وإسنادات متعددة وانتقالات | GPM-1 |
| GPM-3 | اعتماديات المهام | DAG Finish-to-Start، منع الدورة والحجب و`planVersion` | GPM-2 |
| GPM-4 | التعاون | متابعة ذاتية، مرشح following، تعليقات project/task append-only | GPM-1؛ يدمج بعد GPM-3 لتقليل تداخل الملفات |
| GPM-5 | اعتماد baseline اختياري | Subject واحد مضبوط وبصمة snapshot وMaker/Checker، إذا اعتمدت سياسة أعمال | GPM-3 + Approvals + قرار نطاق مستقل |
| GPM-6A | نسبة المصروف | مرجع مشروع اختياري في Employee Expense يملكه سياق المصروفات | GPM-1 + ADR تعديل Employee Expenses |
| GPM-6B | مصدر الفوترة | تحويل مصدر معتمد إلى Sales من دون نسخ حقائق الفاتورة | GPM-1 + سياسة تسعير/ضريبة/عكس وADR مالي مستقل |

لا تدمج GPM-5 أو GPM-6A أو GPM-6B لمجرد وجود Ports في التصميم. كل واحدة تحتاج
مستهلكًا وسياسة أعمال ومعيار قبول مستقلين. لا تعمل مهمتان في ملفات العقود أو Schema
أو migrations بالتوازي؛ المدير يسلسلها.

## 5. GPM-1 — سجل المشروع العام

### حدود الإغلاق

يستطيع مدير مخول إنشاء مشروع عام، ربطه اختياريًا بعميل موجود، اختيار مدير Employee،
ثم عرضه وتحديث أولويته وتواريخه ونقله إلى `ACTIVE/ON_HOLD/COMPLETED/CANCELLED` وفق
القواعد. تظهر قائمة الشركة مع مرشحات الحالة والأولوية والعميل و`mine`.

### HTTP المستهدف

- `GET/POST /general-projects`.
- `GET/PATCH /general-projects/{generalProjectId}`.
- `POST /general-projects/{generalProjectId}/transition`.
- `GET /general-projects/customer-options` عند توفر `SALES`.
- `GET /general-projects/employee-options`.
- `POST /general-projects/{generalProjectId}/members`.
- `POST /general-projects/{generalProjectId}/members/{memberId}/unassign`.

POST/PATCH/transition/assign/unassign تتطلب CSRF و`Idempotency-Key`. تحمل PATCH
وtransition النسخة المتوقعة. يعيد cross-company أو غير الموجود 404 غير كاشف، وتعود
المراجع الخارجية غير الصالحة Validation/Conflict لا أخطاء Prisma.

### Module وRBAC

- يضاف `GENERAL_PROJECTS` إلى عقد platform modules و`/auth/me` والـSeed والكتالوج.
- تضاف صيغة `GPR-######` ونوع `GENERAL_PROJECT` إلى
  `MASTER_DATA_CODE_POLICY_AR.md` في التغيير التنفيذي نفسه؛ لا تصبح صيغة ADR وحدها
  إعدادًا تشغيليًا.
- dependency الاستحقاقية: `GENERAL_PROJECTS -> HUMAN_RESOURCES` فقط.
- لا dependency أو grandfathering ضمني مع `PROFESSIONAL_PROJECTS`.
- GPM-1 تفعل `general_projects.view` و`general_projects.manage`.
- الأدوار المخصصة لا تحصل على الصلاحيات تلقائيًا؛ يمنحها المسؤول صراحة. قرار منح
  `admin` الافتراضي يوثق في Migration ويختبر.

### بوابة القبول

- مشروع واحد ورمز واحد تحت إرسالين متزامنين بالمفتاح والجسم نفسيهما.
- `IDEMPOTENCY_MISMATCH` للجسم المختلف و`VERSION_CONFLICT` للنسخة القديمة.
- رفض عميل/موظف من شركة أخرى ورفض موظف غير نشط، ومنع آخر مدير.
- لا صف يتغير في Professional Projects أو HR/Sales/Ledger عند النجاح أو الفشل.
- العقد والواجهة والترجمات والعزل واختبار migration على المحركين ناجحة.

## 6. GPM-2 — الخطة والمسؤولون

### HTTP المستهدف

- `GET /general-projects/{generalProjectId}/plan`.
- `POST /general-projects/{generalProjectId}/phases`.
- `PATCH /general-project-phases/{generalProjectPhaseId}`.
- `POST /general-project-phases/{generalProjectPhaseId}/transition`.
- `POST /general-project-phases/{generalProjectPhaseId}/tasks`.
- `PATCH /general-project-tasks/{generalProjectTaskId}`.
- `POST /general-project-tasks/{generalProjectTaskId}/transition`.
- `POST /general-project-tasks/{generalProjectTaskId}/assignees`.
- `POST /general-project-tasks/{generalProjectTaskId}/assignees/{assignmentId}/unassign`.

تفعل الشريحة `general_projects.progress`. إدارة البنية والإسناد تتطلب
`general_projects.manage`. نقل حالة المهمة يتطلب `general_projects.progress` مع كون
الممثل مسؤولًا نشطًا، أو `general_projects.manage` بوصفه override يسجل في Audit.

### بوابة القبول

- صحة حدود التواريخ وترتيبها وحالات project/phase/task والإلغاء المسبب.
- رفض مسؤول غير عضو أو من شركة أخرى، ومنع مهمة `IN_PROGRESS` بلا مسؤول.
- صحة `planVersion` ونسخ الأطفال تحت تعديلين متزامنين.
- عدم استخدام `MAX()+1` بلا قفل، وعدم تكرار sequence تحت الإنشاء المتزامن.
- مجموعات القائمة والخطة paginated أو bounded، ولا N+1 غير محدود.

## 7. GPM-3 — الاعتماديات

### HTTP المستهدف

- `POST /general-project-task-dependencies`.
- `POST /general-project-task-dependencies/{dependencyId}/remove`.

لا يضاف نوع اعتماد أو lag في الطلب؛ النوع الأول ثابت Finish-to-Start. تحمل الأوامر
`planVersion` ونسخ المهام اللازمة.

### بوابة القبول

- رفض self/cross-company/cross-project/duplicate والدورة المباشرة وغير المباشرة.
- إضافتان متزامنتان كان اتحادهما سيولد دورة تنتج نجاحًا واحدًا وConflict آمنًا.
- منع بدء التابعة قبل اكتمال كل السابقات، وعدم فتحها تلقائيًا عند إلغاء السابقة.
- إزالة منطقية idempotent ومسببة مع بقاء السجل.

## 8. GPM-4 — المتابعة والتعليقات

### HTTP المستهدف

- `PUT /general-projects/{generalProjectId}/followers/me`.
- `DELETE /general-projects/{generalProjectId}/followers/me`.
- `GET /general-projects/{generalProjectId}/comments` مع `taskId/cursor/limit`.
- `POST /general-projects/{generalProjectId}/comments` مع `taskId` اختياري.

تفعل الشريحة `general_projects.follow` و`general_projects.comment`. تتطلب القراءة
`general_projects.view`؛ ولا يكفي follow أو comment وحده لتجاوزها.

### بوابة القبول

- متابعة وإلغاء متابعة متزامنان يحسمهما version/idempotency بلا صفين فعالين.
- مرشح `following` لا يعرض مشروع شركة أخرى.
- إعادة إرسال التعليق لا تكرره، ورفض task من مشروع/شركة أخرى.
- لا HTML تنفيذي، ولا اسم/بريد منسوخ، ولا نص تعليق في logs أو Audit details.
- لا Outbox أو بريد أو ادعاء إشعارات في هذه الشريحة.

## 9. التكاملات اللاحقة المحكومة

### GPM-5 — Approvals

إذا احتاج العمل اعتماد baseline، يضاف `GENERAL_PROJECT_BASELINE` إلى Subject enum
فقط بعد تحديد:

- متى يرسل المشروع ومن يملك صلاحية الإرسال.
- snapshot canonical وبصمتها ونسخة `planVersion`.
- حالة يملكها General Projects، وما يحدث عند الرفض أو تغير الخطة.
- ترتيب قفل `ApprovalRequest -> GeneralProject -> plan rows`، ومنع Maker من القرار.

لا ينسخ المشروع `ApprovalDecision`، ولا يقرأ Approvals جداول الخطة مباشرة، ولا يجعل
الاعتماد شرطًا عامًا لكل منشأة بلا سياسة.

### GPM-6A — Employee Expenses

يعدل مالك Employee Expenses عقده وترحيله ليحمل `generalProjectId` اختياريًا على
البند إذا اعتمدت النسبة. يتحقق عبر `GeneralProjectReferencePort` من الشركة والحالة،
ولا ينسخ الاسم أو الرمز أو الأولوية. لا يخزن General Projects claim أو مبلغًا أو
حالة `READY_FOR_PAYMENT`، ولا يعد قبول المطالبة تكلفة مدفوعة أو مرحلة.

تأتي مجاميع العرض من Reporting/Application read composer عبر Query Ports، بعملة
المطالبة وDecimal نصي، ولا تجمع عملات مختلفة ولا تخزن الإجمالي على المشروع.

### GPM-6B — Sales billing

لا تبدأ قبل قرار يحدد مصدر الفوترة: milestone معتمد أو عقد/سعر أو مبلغ ثابت، وسياسة
الضريبة والحساب والفترة والعكس. عندها يستدعي General Projects
`GeneralProjectBillingSalesPort` داخل المعاملة اللازمة؛ Sales يحسب ويحفظ الفاتورة
والضريبة والذمة ويستدعي `PostingEngine`.

يجوز للمشروع حفظ هوية ونسخة المصدر المستخدم ومرجع فاتورة Sales فقط لمنع الاستخدام
مرتين. لا ينسخ رقم الفاتورة أو إجماليها أو ضريبتها أو الرصيد أو Journal IDs؛ تعرض
هذه الحقائق من `GeneralProjectBillingQueryPort` يملكه Sales.

## 10. التزامن وترتيب الأقفال

### إنشاء المشروع

```text
Idempotency
-> Employee reference عند اختيار المدير
-> Customer validation غير القافل عند وجوده
-> MasterDataCodeSequence(GENERAL_PROJECT)
-> GeneralProject + GeneralProjectMember
-> Audit
```

### تعديل الخطة

```text
Idempotency
-> Employee references المطلوبة مرتبة تصاعديًا
-> GeneralProject
-> Phase rows ascending
-> Task rows ascending
-> Dependency rows ascending
-> Member/Assignment rows ascending
-> Audit
```

### المتابعة والتعليق

```text
Idempotency
-> UserCompany reference
-> GeneralProject
-> Follower أو task/comment target
-> Audit
-> Outbox مستقبلًا فقط
```

- يقفل كل مسار عدة معرفات من النوع نفسه تصاعديًا.
- لا يستدعي أي Port شبكة ولا ينام داخل transaction؛ المنافذ المحلية فقط.
- يعاد تنفيذ المعاملة كاملة عند خطأ قاعدة transient مصنف، بحد المحاولات والـdeadline
  المركزيين؛ لا يعاد Business conflict.
- كل CAS يقيد `id + companyId + version + status` عند الصلة.
- العمليات في شركتين مختلفتين لا تتنافس على Project/Sequence مشترك.

## 11. ترحيلات forward والرجوع

لكل شريحة migration مستقلة بعد أحدث migration في `main`؛ لا تجمع الجداول الثمانية
والتكاملات المالية في migration واحدة.

### بوابة forward المشتركة

1. `prisma format/validate/generate` والعقد المولد من OpenAPI متوافقان.
2. تطبيق كل migrations على قاعدة فارغة MariaDB 10.11 وMySQL 8.4.
3. ترقية نسخة من baseline السابق ببيانات Professional Projects وHR وExpenses، مع
   إثبات عدم تغير صفوفها أو enums أو رموزها.
4. تشغيل Seed مرتين بأمان، وفحص module dependencies والصلاحيات.
5. نشر expand قبل تفعيل navigation/entitlement عند الحاجة إلى طرح مرحلي.

### بوابة rollback المشتركة

- قبل الاستخدام فقط: يتحقق script من صفر صفوف في جداول الشريحة وصفر مراجع من
  Approvals/Expenses/Sales قبل أي DDL مدمر، ويختبر في قاعدة معزولة على المحركين.
- بعد الاستخدام: يمنع الإسقاط أو تضييق enum أو إزالة permission/module code الذي
  ما زال مستخدمًا. يعطل entitlement والكتابة والواجهة، وتبقى القراءة والتاريخ أو
  يطرح Binary توافق، ثم ينفذ forward migration لاحقًا.
- لا يعاد استخدام أرقام `GPR-`، ولا يحذف Audit أو comments أو dependency history.
- رجوع GPM-5/6 يتحقق أيضًا من عدم وجود طلب موافقة معلق أو مرجع مطالبة/فاتورة؛ لا
  يكفي خلو جداول General Projects وحدها.

## 12. مصفوفة الاختبار الكاملة

### المجال والعزل

- حالات المشروع/المرحلة/المهمة، التواريخ، الأولويات، والمدير الأخير.
- كل قائمة وتفاصيل وخيارات ومجاميع وتعليقات مع شركتين واختبار معرف forged.
- علاقات مركبة ترفض customer/employee/user/task من شركة أخرى عند قاعدة البيانات.
- لا وصول مباشر أو كتابة إلى Professional Projects أو HR/Sales/Expenses/Approvals/
  Treasury/Ledger، مع architecture guard.

### التزامن والـIdempotency

- نفس المفتاح والجسم ينتجان أثرًا واحدًا لكل create/transition/assign/follow/comment.
- نفس المفتاح وجسم مختلف يرفض، ونسخة قديمة تعيد `VERSION_CONFLICT`.
- سباق آخر مدير، وإسناد مقابل إلغاء عضو، وإكمال مقابل إضافة مهمة.
- إنشاء phase/task متزامن بلا sequence مكرر.
- سباق dependency يصنع دورة، وتعديل موعد مقابل إكمال.
- retry/deadlock exhaustion/deadline يترك rollback كاملًا ولا يكرر Audit.

### Ports والعقود

- Contract tests لكل Adapter: Company Profile وCustomer وEmployee وPeople.
- عند غياب Sales يبقى المشروع الداخلي صالحًا وتختفي خيارات العميل؛ لا fallback
  لقراءة Prisma.
- OpenAPI route parity، الحراس المولدة، Redocly، response validation، CSRF،
  `Cache-Control: no-store`، BIGINT/UUID/date serialization.
- module code وصلاحياته متطابقة بين API/Web/Seed/خطة الاشتراك، ولا يمنح
  `PROFESSIONAL_PROJECTS` وصولًا إلى المسارات العامة أو العكس.

### MariaDB/MySQL والترحيل

- الاختبارات التنافسية المذكورة على MariaDB 10.11 وMySQL 8.4 الفعليين، لا mocks
  أو SQLite فقط.
- قاعدة فارغة، ترقية baseline، replay migration/seed، rollback قبل الاستخدام ورفضه
  بعد وجود تاريخ.
- فحص explain/pagination لقائمة المشاريع والخطة والتعليقات، وحدود `limit/cursor`.

### الواجهة والإتاحة وRTL

- أربع لغات: العربية والإنجليزية والهندية والأردية، بلا نص مرئي ثابت داخل JSX.
- RTL للعربية والأردية وLTR للإنجليزية والهندية، وعروض 390/768/1440/1920 من دون
  overflow أفقي غير مقصود.
- مقاسان أساسيان متسقان للخط: عنوان معتدل ونص مريح؛ المستوى الثانوي بالوزن والمسافة،
  وبلا خط زخرفي قصير تحت العنوان.
- كل نموذج يملك label ورسالة خطأ مرتبطة، وترتيب focus منطقي، وfocus ظاهر، واستخدام
  كامل بلوحة المفاتيح. لا يعتمد الترتيب أو الاعتمادية على اللون وحده.
- الجداول الواسعة تملك بديل بطاقات أو تمريرًا معلنًا على الهاتف، والأزرار ذات أهداف
  لمس مناسبة، والحوارات تعيد focus عند الإغلاق.
- قارئ الشاشة يعلن الحالة والأولوية والحجب، ويؤكد الإلغاء/التعليق بلا نقل قرار RBAC
  إلى العميل.

## 13. خارج النطاق

- الوقت المهني وTimesheets والأسعار والعقود المهنية والجدار الأخلاقي.
- Gantt وcritical path والـlag والمهام المتكررة وresource leveling.
- Baseline معتمد وchange control حتى GPM-5.
- ملفات ومرفقات وmentions وتقويم وتنبيهات قبل سياسة Storage/Outbox.
- ميزانية مالية أو ربحية أو earned value أو صرف أو ترحيل محاسبي.
- تحويل تلقائي من CRM أو Professional Projects أو استيراد تاريخي تخميني.
- تطبيق هاتف مستقل؛ الواجهة الأولى responsive وتستخدم OpenAPI نفسه.

## 14. تعريف التسليم لكل شريحة

يوثق تقرير كل شريحة:

- ما نُفذ وما اختُبر فعليًا على كل محرك وما لم يُختبر.
- SHA الالتزام ونتيجة CI المنفصلة عن دليل Staging/Production.
- forward/rollback gate وأي بيانات تمنع الرجوع.
- الاستثناءات المتبقية بمالك وخطة إزالة، بلا نسبة تقدم تقديرية.

نجاح محلي أو Staging لا يعني نشرًا إنتاجيًا. لا push أو PR أو دمج أو نشر دون إذن
المستخدم المناسب، ولا ينتقل إذن جولة سابقة إلى شريحة لاحقة.
