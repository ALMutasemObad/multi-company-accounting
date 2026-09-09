---
title: "ADR-021 — General Project Delivery Context"
status: "proposed for acceptance; implementation not started"
version: "1.3"
date: "2026-09-09"
decision_owner: "Architecture"
related:
  - "ADR-006-professional-services-projects-priority.md"
  - "ADR-010-professional-project-planning.md"
  - "ADR-018-business-profile-and-progressive-compliance.md"
  - "ADR-020-employee-expense-claims.md"
  - "GENERAL_PROJECT_MANAGEMENT_SLICE_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
---

# ADR-021: فصل إدارة المشاريع العامة عن تسليم المشاريع المهنية

## السياق

يملك النظام سياق `Professional Project Delivery` المنفذ للقضايا القانونية والتكليفات
الاستشارية ومشاريع الخدمات المهنية. يرتبط هذا السياق بعميل، وفريق مهني، ووقت خام
وTimesheets، وعقود وأسعار وفوترة خدمات، ويطبق جدارًا أخلاقيًا عند الحاجة. كما يحتوي
العقد الحالي على النوع `ProfessionalProjectKind.PROFESSIONAL_PROJECT`؛ ودلالته مشروع
خدمات **مهني** عام داخل ذلك السياق، وليست مشروعًا تشغيليًا عامًا لكل أقسام المنشأة.

تحتاج المنشآت في المقابل إلى إدارة أعمال داخلية أو تشغيلية عابرة للأقسام: إطلاق فرع،
تحسين إجراء، تنفيذ حملة، تجهيز نظام، أو مبادرة غير مرتبطة حتمًا بعميل أو وقت قابل
للفوترة. إعادة استخدام جداول `professional_projects` أو مساراتها وصلاحياتها لهذه
الحالات ستجعل الفوترة والجدار الأخلاقي والوقت المهني افتراضات ضمنية، وتمنع شراء
الموديولين أو تشغيلهما باستقلال.

## القرار

اعتماد Bounded Context جديد باسم **General Project Delivery**، مستقل في الملكية
والعقد والتنقل والاستحقاق عن **Professional Project Delivery**. يملك السياق الجديد
حقائق المشروع العام وخطته وتعاونه فقط:

- المشروع العام وحالته وأولويته وتواريخه.
- المراحل والمهام وتواريخها وأولوياتها.
- اعتماديات المهام من نوع Finish-to-Start في البداية.
- فريق المشروع وإسنادات المسؤولية إلى موظفي HR.
- المتابعين من عضويات الشركة في Identity.
- التعليقات النصية على المشروع أو المهمة.

لا يملك السياق الجديد العميل أو الموظف أو المستخدم أو قرار الموافقة أو مطالبة
المصروف أو الفاتورة أو الضريبة أو الذمة أو الدفع أو القيد. يستهلك هذه الحقائق، عند
الحاجة، عبر Ports صغيرة يملك تنفيذ كل منها السياق المصدر.

## قاموس الاسم ومنع التضارب

الأسماء التالية محجوزة للسياق الجديد، ولا يجوز اختصارها إلى `Projects` في الكود أو
العقد:

| العنصر | الاسم المعتمد |
|---|---|
| Bounded Context | `General Project Delivery` |
| module code | `GENERAL_PROJECTS` |
| مجلد API | `apps/api/src/general-projects` |
| بادئة Prisma models | `GeneralProject...` |
| بادئة الجداول | `general_project_...` والجذر `general_projects` |
| بادئة HTTP | `/api/v1/general-projects` |
| مسار الواجهة | `#generalProjects` |
| بادئة الصلاحيات | `general_projects.` |
| بادئة الأحداث المستقبلية | `GeneralProject...` |
| رمز البيانات الرئيسي | `GPR-######` ونوع التسلسل `GENERAL_PROJECT` |

تبقى الأسماء الحالية بلا تغيير:

- `ProfessionalProject` و`professional_projects` و`/professional-projects`.
- `PROFESSIONAL_PROJECTS` و`professional_projects.*`.
- `ProfessionalProjectKind.PROFESSIONAL_PROJECT`، ويعرض للمستخدم بوصفه «مشروع
  خدمات مهنية» لا «مشروعًا عامًا».

يمنع إنشاء `/projects` أو `Project` أو module code باسم `PROJECTS` بوصفها aliases
مشتركة. لا يرث `GeneralProject` من `ProfessionalProject`، ولا ينشأ جدول أب أو اتحاد
polymorphic بينهما، ولا تنقل البيانات الحالية تلقائيًا. إذا ثبت أن سجلات تاريخية
أدخلت في النوع المهني وهي في حقيقتها مشاريع عامة، فتنقل لاحقًا بأداة استيراد/تحويل
صريحة ومدققة بعد اختيار المستخدم وربط الموظفين والحالات؛ لا يوجد backfill تخميني.

## Aggregate وحدود البيانات

### `GeneralProject`

هو Aggregate root ويحمي:

- `companyId` وعلاقات مركبة تمنع أي مرجع عابر للشركات.
- `publicId` كمعرف HTTP، و`code` خادمي ثابت بصيغة `GPR-######` للعرض والبحث فقط.
- الاسم والوصف، و`customerId` اختياري إلى عميل Sales عند كون المشروع خارجيًا.
- الحالة `DRAFT/ACTIVE/ON_HOLD/COMPLETED/CANCELLED`.
- الأولوية `LOW/NORMAL/HIGH/URGENT`.
- `plannedStartDate` و`targetEndDate` كتواريخ محلية للمنشأة، لا timestamps محولة
  ضمنيًا إلى UTC.
- `version` لتعديلات الرأس والحالة، و`planVersion` لكل تغيير في topology الخطة.

لا يخزن المشروع اسم العميل أو رمزه أو رصيده أو عملته أو قيمة عقد أو إجمالي مصروف أو
فاتورة. العميل اختياري، وتغييره لا يعيد كتابة أي مستند مالي أو مهني.

### الخطة

- `GeneralProjectPhase`: ترتيب خادمي، عنوان ووصف، تاريخا بدء/نهاية مخططان، حالة
  `PLANNED/IN_PROGRESS/COMPLETED/CANCELLED` و`version`.
- `GeneralProjectTask`: مرحلة ومشروع وشركة، ترتيب خادمي، عنوان ووصف، أولوية، تاريخا
  بدء/استحقاق، حالة `TODO/IN_PROGRESS/BLOCKED/COMPLETED/CANCELLED` و`version`.
- `GeneralProjectTaskDependency`: سابقة وتابعة من المشروع والشركة نفسيهما، فعالة/ملغاة
  منطقيًا و`version`. تدعم الشريحة الأولى Finish-to-Start فقط.

تمنع الاعتمادية الذاتية والمكررة والعابرة للمشروع والدورات المباشرة وغير المباشرة.
لا تبدأ المهمة التابعة حتى تكون كل سابقاتها الفعالة `COMPLETED`. إلغاء السابقة لا
يفتح التابعة تلقائيًا؛ تزال الاعتمادية بأمر مسبب أو يعاد تخطيط العمل.

| أمر الاعتمادية | حالة السابقة | حالة التابعة | العقد |
|---|---|---|---|
| إضافة | غير نهائية | غير نهائية | `general_projects.manage` و`expectedPlanVersion`؛ يمنع أي طرف نهائي |
| إزالة عادية | غير نهائية | غير نهائية | `general_projects.manage` و`expectedPlanVersion + expectedVersion + reason` |
| إزالة استردادية ضيقة | `CANCELLED` فقط | `TODO/IN_PROGRESS/BLOCKED` | يسمح بإزالة الرابط الفعال فقط، بالصلاحية والنسخ والسبب نفسها؛ لا تعديل أو إضافة |

تنفذ الإزالة الاستردادية داخل معاملة واحدة: Idempotency ثم قفل المشروع، ثم السابقة
والتابعة بترتيب المعرف، ثم صف `GeneralProjectTaskDependency`. يعاد التحقق من
`companyId` وحالة المشروع غير النهائية، ومن أن السابقة `CANCELLED` والتابعة غير
نهائية والرابط فعال، ثم ينفذ CAS على `expectedVersion` ويزيد `planVersion` مرة واحدة
ويسجل Audit باسم `GENERAL_PROJECT_TASK_DEPENDENCY_REMOVED_AFTER_PREDECESSOR_CANCELLED`
مع المعرفات والنسخ والسبب المنقح. لا ينشأ Outbox في الشريحة الحالية لعدم وجود مستهلك؛
إذا اعتمد تنبيه لاحقًا فيكتب حدثه في المعاملة نفسها وفق السياسة العامة.

التأخر ومؤشرات الصحة حقائق مشتقة من التاريخ والحالة وتاريخ المنشأة، ولا تخزن كحالة
موازية. لا يوجد Gantt أو critical path أو baseline معتمد في الشريحة الأولى.

### المسؤولون والمتابعون

- `GeneralProjectMember` يربط موظف HR نشطًا بالمشروع بدور
  `MANAGER/CONTRIBUTOR`، ويحفظ تاريخ التعيين والإلغاء و`version` من دون نسخ اسم
  الموظف أو قسمه.
- `GeneralProjectTaskAssignment` يربط المهمة بعضو مشروع نشط بدور
  `RESPONSIBLE/CONTRIBUTOR`. يسمح بأكثر من مسؤول؛ لا تستخدم قائمة معرفات أو JSON
  داخل المهمة.
- يلزم مسؤول نشط واحد على الأقل قبل نقل المهمة إلى `IN_PROGRESS`، ويمنع إلغاء عضو
  ما دام مسؤولًا عن مهمة غير نهائية.
- `GeneralProjectFollower` يربط عضوية مستخدم في الشركة بالمشروع، ويتيح مرشح
  «أتابعها». المتابعة لا تمنح RBAC ولا عضوية فريق ولا صلاحية رؤية جديدة.

بقاء مرجع موظف منتهي أو عضوية ملغاة يحفظ التاريخ ولا يمحو الإسناد السابق؛ تستبعد
المراجع غير النشطة من الخيارات الجديدة ويظهر وضعها التاريخي من Query Port.

### التعليقات والنشاط

تعتمد الشريحة الأولى **التعليقات** بدل إنشاء Activity feed مكرر:

- `GeneralProjectComment` حقيقة تعاون يملكها السياق، مرتبطة دائمًا بمشروع ويمكن
  ربطها بمهمة من المشروع نفسه.
- النص العادي فقط، من 1 إلى 2000 حرف، بلا ملفات أو HTML أو mentions أو تعديل/حذف
  في الشريحة الأولى.
- يحمل التعليق `authorUserId` ووقت الإنشاء، ولا ينسخ اسم الكاتب أو بريده.
- الإنشاء idempotent كي لا ينتج التعليق مرتين عند إعادة الإرسال.

`AuditLog` سجل امتثال منفصل وليس feed للمستخدم، ولا يستخدم بوصفه مخزن تعليقات أو
Outbox. إذا أضيف نشاط مرئي لاحقًا فيكون Projection صريحًا بعقد وRetention، لا قراءة
عشوائية من Audit.

## الحالات والانتقالات وقابلية التعديل

### انتقال المشروع

| من | إلى | الصلاحية | الشروط والسبب |
|---|---|---|---|
| `DRAFT` | `ACTIVE` | `general_projects.manage` | مدير نشط واحد على الأقل؛ لا سبب إلزامي |
| `DRAFT` | `CANCELLED` | `general_projects.manage` | `reason` من 10 إلى 500 حرف |
| `ACTIVE` | `ON_HOLD` | `general_projects.manage` | `reason` من 10 إلى 500 حرف |
| `ACTIVE` | `COMPLETED` | `general_projects.manage` | كل المراحل والمهام نهائية، ولا مهمة `BLOCKED`؛ `completionNote` اختياري |
| `ACTIVE` | `CANCELLED` | `general_projects.manage` | `reason` من 10 إلى 500 حرف |
| `ON_HOLD` | `ACTIVE` | `general_projects.manage` | `reason` يوضح استئناف العمل |
| `ON_HOLD` | `CANCELLED` | `general_projects.manage` | `reason` من 10 إلى 500 حرف |

لا يوجد انتقال من `COMPLETED/CANCELLED` ولا أمر reopen في الشرائح الأولى.

### انتقال المرحلة

| من | إلى | الصلاحية | الشروط والسبب |
|---|---|---|---|
| `PLANNED` | `IN_PROGRESS` | `general_projects.manage` | المشروع `ACTIVE`؛ لا تبدأ تلقائيًا مع أول مهمة |
| `PLANNED` | `CANCELLED` | `general_projects.manage` | المشروع غير نهائي، وكل مهام المرحلة `COMPLETED/CANCELLED`، و`reason` إلزامي |
| `IN_PROGRESS` | `COMPLETED` | `general_projects.manage` | كل مهام المرحلة `COMPLETED/CANCELLED` |
| `IN_PROGRESS` | `CANCELLED` | `general_projects.manage` | المشروع غير نهائي، وكل مهام المرحلة `COMPLETED/CANCELLED`، و`reason` إلزامي |

`COMPLETED/CANCELLED` حالتان نهائيتان للمرحلة؛ لا PATCH أو transition أو إنشاء مهمة
داخلهما. الإلغاء لا يطبق cascade ولا يجمد عملًا مفتوحًا: يجب إكمال أو إلغاء كل مهمة
غير نهائية بأمرها وصلاحيتها وسببها أولًا، ثم إلغاء المرحلة.

### انتقال المهمة و`BLOCKED`

| من | إلى | الصلاحية | الشروط والسبب |
|---|---|---|---|
| `TODO` | `IN_PROGRESS` | `general_projects.progress` للمسؤول النشط، أو `general_projects.manage` كـoverride مدقق | المشروع والمرحلة `ACTIVE/IN_PROGRESS` على الترتيب، مسؤول نشط، وكل السابقات الفعالة `COMPLETED` |
| `TODO` | `BLOCKED` | الصلاحية نفسها | المشروع `ACTIVE` و`blockReason` من 10 إلى 500 حرف |
| `TODO` | `CANCELLED` | `general_projects.manage` | `reason` إلزامي |
| `IN_PROGRESS` | `BLOCKED` | صلاحية التقدم نفسها | `blockReason` إلزامي |
| `IN_PROGRESS` | `COMPLETED` | صلاحية التقدم نفسها | المسؤول/override و`completionNote` اختياري |
| `IN_PROGRESS` | `CANCELLED` | `general_projects.manage` | `reason` إلزامي |
| `BLOCKED` | `TODO` | صلاحية التقدم نفسها | أمر unblock صريح مع `resolutionReason` من 10 إلى 500 حرف؛ لا ينتقل مباشرة إلى `IN_PROGRESS` |
| `BLOCKED` | `CANCELLED` | `general_projects.manage` | `reason` إلزامي |

`BLOCKED` حالة يختارها الفاعل بسبب محفوظ، وهي مستقلة عن
`dependencyBlocked=true` المشتقة. اكتمال السابقة لا يزيل `BLOCKED` اليدوية، وإزالة
الحجب اليدوي لا تتجاوز سابقة غير مكتملة. `COMPLETED/CANCELLED` نهائيتان؛ لا PATCH أو
transition أو إسناد أو تعليق موجه للمهمة بعدهما. لا تغير اعتمادية طرف نهائي، باستثناء
الإزالة الاستردادية الضيقة لرابط فعال من سابقة `CANCELLED` إلى تابعة غير نهائية؛ لا
تفتح المهمة التابعة ولا تغير `BLOCKED` اليدوية تلقائيًا.

### مصفوفة قابلية التعديل

| العملية | `DRAFT` | `ACTIVE` | `ON_HOLD` | `COMPLETED/CANCELLED` |
|---|---|---|---|---|
| PATCH رأس المشروع | مسموح بـmanage | مسموح بـmanage | مسموح بـmanage | مرفوض |
| إنشاء/تعديل الخطة والفريق | مسموح بـmanage | مسموح بـmanage | مسموح لإعادة التخطيط بـmanage | مرفوض |
| انتقال تقدم مهمة | مرفوض | مسموح وفق جدول المهمة | مرفوض حتى استئناف المشروع | مرفوض |
| متابعة جديدة أو تعليق جديد | مسموح بالصلاحية المختصة | مسموح | مسموح | مرفوض |
| القراءة | مسموحة وفق view | مسموحة | مسموحة | مسموحة للحفاظ على التاريخ |

يجوز للمستخدم إلغاء **متابعته الذاتية** بعد نهائية المشروع لأنها تفضيل شخصي لا يغير
حقيقة المشروع؛ لا يجوز إنشاء متابعة جديدة. فيما عدا ذلك يصبح رأس المشروع وخطته
وفريقه واعتمادياته وتعليقاته read-only بعد النهائية. لا توجد cascade transitions أو
تصحيحات صامتة؛ أي دعم reopen أو redaction يحتاج قرارًا لاحقًا.

يسمح بإنشاء مرحلة فقط في مشروع غير نهائي، وتعديل مرحلة فقط في
`PLANNED/IN_PROGRESS`. يسمح بإنشاء مهمة فقط داخل مرحلة `PLANNED/IN_PROGRESS` في
مشروع غير نهائي، وتعديلها فقط في `TODO/IN_PROGRESS/BLOCKED`. تعديل العضوية والإسناد
والاعتمادية يتطلب أطرافًا غير نهائية و`general_projects.manage` وسببًا عند الإلغاء،
عدا إزالة الرابط الاستردادية المحددة أعلاه؛ لا توسع الاستثناء إلى سابقة `COMPLETED`
أو تابعة نهائية أو إضافة/تعديل رابط.
يرفض transition إلغاء المرحلة ما دام أي طفل `TODO/IN_PROGRESS/BLOCKED`؛ لا تحول
المهمة أو تلغى ضمنيًا مع المرحلة.

- كل إلغاء مدقق ولا يحذف المراحل أو المهام أو التعليقات.
- لا يكتمل المشروع وفيه مرحلة أو مهمة غير نهائية.
- لا تكتمل المرحلة وفيها مهمة غير نهائية.
- تقع تواريخ المهمة داخل حدود مرحلتها عند اكتمال الحدين، وتقع تواريخ المرحلة داخل
  حدود المشروع عند اكتمال الحدين. يسمح بالقيم الناقصة ولا يخمن الخادم تاريخًا.
- تغيير موعد أو أولوية لا يعد موافقة ولا يولد تنبيهًا في الشريحة الأولى.
- لا تستخدم تواريخ المشروع العام بوصفها موعدًا قضائيًا؛ المواعيد القانونية تبقى
  خارج هذا السياق وضمن قرارات Professional Project Delivery المختصة.

## حدود التكامل والـPorts

| العلاقة | اتجاه المنفذ | القرار |
|---|---|---|
| سياق المنشأة | General Projects يستهلك `GeneralProjectCompanyContextQueryPort` محدودًا من Tenant عند الحاجة إلى المنطقة الزمنية واسم العرض | لا يعتمد على `CompanyProfile` أو profile/compliance أو readiness، ولا ينسخ الملف أو التسجيل أو العنوان |
| العميل | General Projects يستهلك `GeneralProjectCustomerQueryPort` من Sales | `customerId` اختياري؛ لا نسخ لاسم/رمز/رصيد العميل ولا كتابة إلى `Customer` |
| الموظفون | General Projects يستهلك `GeneralProjectEmployeePort` من HR | التحقق من موظف الشركة النشط وخيارات العرض؛ لا كتابة إلى `Employee` أو العقد |
| المتابعون والكاتب | General Projects يستهلك `GeneralProjectPeoplePort` من Identity | التحقق من عضوية الشركة وعرض مرجع محدود؛ لا دور أو صلاحية تمنحها المتابعة |
| الموافقات | Approvals يستدعي Adapter يقدمه General Projects لأي Subject يعتمد لاحقًا | Approvals يملك الطلب والقرار فقط؛ General Projects يملك حالة الخطة/التغيير ولا ينسخ القرار |
| المصروفات | Employee Expenses يستهلك `GeneralProjectReferencePort` عند إضافة `generalProjectId` اختياريًا إلى بند المصروف مستقبلًا | Employee Expenses يملك الرابط والمبلغ والحالة؛ General Projects لا يخزن المبلغ أو claim status ولا يكتب المطالبة |
| ملخص تكلفة | واجهة قراءة مركبة أو Reporting تستهلك Query Ports من General Projects وEmployee Expenses | لا يستدعي Domain أحدهما الآخر لتكوين dashboard ولا ينشأ مصدر إجمالي موازٍ |
| الفوترة | General Projects يستدعي `GeneralProjectBillingSalesPort` فقط في شريحة فوترة مقبولة لاحقًا | Sales يملك الفاتورة والضريبة والذمة والترحيل؛ لا نسخ لرقم الفاتورة أو إجمالياتها أو قيدها |

كل Adapter خرساني يوجد عند مالك البيانات أو composition root. يمنع استيراد Service
خرسانية أو Prisma type من سياق آخر. لا تعد هذه القائمة موافقة على تنفيذ الموافقات أو
ربط المصروف أو الفوترة الآن؛ كل أثر مالي يحتاج سياسة مصدر ولقطة وعكس واختبارات وقرار
تفصيلي قبل الكود.

## الاستحقاق وRBAC

يعتمد module code مستقلًا `GENERAL_PROJECTS`، ولا يكون alias أو dependency على
`PROFESSIONAL_PROJECTS`. يعتمد موديول النواة على `HUMAN_RESOURCES` لأن المسؤولية
تسند إلى `Employee`. تبقى `SALES` و`APPROVALS` وقدرات المصروف والفوترة تكاملات
اختيارية؛ تختفي أفعالها إذا غاب استحقاقها، ويعيد الخادم خطأ capability معياريًا عند
طلبها مباشرة.

الصلاحيات المستهدفة:

| الصلاحية | الغرض |
|---|---|
| `general_projects.view` | القائمة والتفاصيل والخطة والتعليقات داخل الشركة |
| `general_projects.manage` | إنشاء المشروع وتعديله وانتقاله وإدارة المراحل والمهام والاعتماديات والفريق |
| `general_projects.progress` | نقل حالة مهمة يكون الممثل مسؤولًا عنها؛ الإدارة تملك override مدققًا |
| `general_projects.follow` | متابعة المستخدم لنفسه أو إلغاؤها فقط |
| `general_projects.comment` | إضافة تعليق ضمن مشروع يحق للممثل عرضه |

لا تمنح عضوية المشروع أو إسناد المهمة أو المتابعة أي صلاحية. ينفذ الخادم تقاطع RBAC
مع entitlement في كل مسار؛ إخفاء الزر في الواجهة ليس حماية. تعطي الشريحة الأولى
صلاحية العرض نطاق الشركة كله، مع مرشحي `mine/following` للراحة فقط. إذا احتاجت
مشاريع عامة مقيدة أو سرية فتعتمد سياسة وصول مستقلة؛ لا يعاد استخدام الجدار الأخلاقي
للقضايا ولا يفترض أن `general_projects.view` يعني الوصول إلى مواد مهنية.

## العزل والتدقيق والأحداث

- كل Query وCAS وعلاقة تشغيلية تحمل `companyId`، وتستخدم العلاقات الحرجة FK مركبًا
  مع الشركة.
- المعرفات العامة UUID، وBIGINT داخلي لا يعبر HTTP إلا كسلسلة عند الحاجة.
- تحفظ أوامر الإنشاء والتعديل والانتقال والإسناد والمتابعة والتعليق Audit منقحًا داخل
  معاملة المجال نفسها؛ لا يسجل نص التعليق كاملًا في details التشغيلية.
- لا يضاف Outbox في شرائح النواة؛ لا يوجد مستهلك تنبيه متعاقد عليه.
- عند اعتماد تنبيه للمسؤولين أو المتابعين لاحقًا، يحفظ حدث مثل
  `GeneralProjectTaskAssigned` أو `GeneralProjectCommentAdded` في المعاملة نفسها،
  بعقد versioned وpayload محدود، ويكون المستهلك idempotent مع retry/dead-letter/
  retention ومراقبة. لا بريد أو Network I/O داخل المعاملة.

## التزامن والأقفال والـIdempotency

كل كتابة تتطلب CSRF و`Idempotency-Key`. تحمل أوامر تعديل الرأس `version`، وتحمل
أوامر topology `planVersion` ونسخة الطفل عند الصلة. المفتاح نفسه والجسم المعياري
نفسه يعيدان النتيجة، والمفتاح نفسه بجسم مختلف يعيد `IDEMPOTENCY_MISMATCH`.

ترتيب الأقفال العام:

```text
Idempotency
-> Employee/UserCompany references المطلوبة مرتبة تصاعديًا عند الإسناد أو المتابعة
-> GeneralProject
-> GeneralProjectPhase rows ascending
-> GeneralProjectTask rows ascending
-> GeneralProjectTaskDependency rows ascending
-> member/assignment/follower rows ascending
-> Audit
-> Outbox مستقبلًا
```

يحجز إنشاء الجذر تسلسل `GENERAL_PROJECT` ذريًا بعد Idempotency والتحقق من المراجع
وقبل insert الجذر، داخل المعاملة نفسها. تولد أرقام المراحل والمهام تحت قفل الجذر؛ لا
يستخدم مسار التشغيل `MAX()+1` بلا قفل ولا يعيد ترتيب السجلات تلقائيًا. قفل الجذر
يسلسل تغييرات DAG، ولذلك يفحص الأمر الدورة بعد القفل ويزيد `planVersion` مرة واحدة.

يستخدم `TransactionExecutor` المركزي retry محدودًا فقط للأخطاء العابرة المصنفة، مع
backoff+jitter وdeadline واحد. لا يعاد `VERSION_CONFLICT` أو خطأ حالة أو صلاحية. لا
يجري Network I/O أو sleep داخل transaction، ولا تعتبر Idempotency بديلًا عن الأقفال
أو النسخة المتفائلة.

## API والتنقل

العقد المستهدف يستخدم `/api/v1/general-projects` فقط. كل مورد طفل يبقى تحت معرف
المشروع، مثل `/api/v1/general-projects/{generalProjectId}/phases/{generalProjectPhaseId}` و
`/api/v1/general-projects/{generalProjectId}/tasks/{generalProjectTaskId}` و
`/api/v1/general-projects/{generalProjectId}/task-dependencies/{dependencyId}`؛ يمنع
إنشاء `/general-project-phases` أو `/general-project-tasks` أو
`/general-project-task-dependencies` كجذور موازية. تبدأ العمليات التالية عبر شرائح
صغيرة:

- قائمة/إنشاء المشروع، تفاصيله وتعديله وانتقاله.
- قراءة الخطة وإنشاء/تعديل/انتقال مرحلة أو مهمة.
- إضافة/إزالة اعتمادية منطقيًا.
- تعيين/إلغاء عضو مشروع، وإسناد/إلغاء مسؤول مهمة.
- متابعة المستخدم لنفسه وإلغاء المتابعة.
- قائمة التعليقات وإضافة تعليق على المشروع أو مهمة منه.

OpenAPI هو مصدر الحقيقة، وأجسام JSON تستخدم الحراس المولدة. `code` للقراءة فقط،
والتواريخ بصيغة `YYYY-MM-DD`، ولا تخرج Prisma records أو أسماء داخلية. كل استجابة
`/api/v1` تحمل `Cache-Control: no-store` وفق الحواجز العامة.

يظهر رابط تنقل مستقل «المشاريع العامة» على `#generalProjects` عند توفر
`GENERAL_PROJECTS` و`general_projects.view`. يبقى رابط «المشاريع المهنية والقضايا»
على `#professionalProjects` مستقلًا. لا تعرض الواجهة تبويبًا مشتركًا يخفي اختلاف
الملكية، لكن يجوز أن تعرض الصفحة الرئيسية بطاقتين وروابط عميقة منفصلة.

## قيد التنسيق المؤقت مع ملف المنشأة

المهمة الجارية `company-profile-bp1` قيد **تنسيق مؤقت** فقط لأنها تلمس Schema وOpenAPI
المشتركين. لا تعد `CompanyProfile` أو `CompanyRegistration` أو
`CompanyTaxRegistration` أو `CompanyAddress` أو واجهتا profile/compliance
prerequisite وظيفيًا أو dependency دائمًا للموديول.

ما دامت المهمة الجارية غير مدمجة، لا تبدأ GPM-1 في ملفات Schema/OpenAPI نفسها إلا
إذا سلّسل المدير الملكية صراحة. بعد دمجها أو إنهائها يبدأ فرع التنفيذ من أحدث
`origin/main` وينتهي هذا القيد؛ ولا يبقى check أو Port أو module dependency عليها.
تعمل المشاريع العامة مع غياب ملف موسع ومع `READY` أو `ACTION_RECOMMENDED`، ولا تسأل
profile/compliance في أوامرها. تستخدم المنطقة الزمنية الأساسية من Tenant company
context فقط لدلالة التاريخ.

تنفذ الشرائح المحددة في [خطة الشريحة](GENERAL_PROJECT_MANAGEMENT_SLICE_AR.md) من دون
خلط ترحيل الموديول مع ترحيل ملف المنشأة أو Professional Projects.

## الترحيل والرجوع

- كل شريحة Schema عبر forward migration من آخر `origin/main` بعد انتهاء قيد تعارض
  ملفات `company-profile-bp1` أو تسلسلها صراحة؛ لا يحجز هذا ADR رقم timestamp مسبقًا.
- الإضافة توسعية: جداول وبادئات جديدة وصلاحيات واستحقاق جديد، بلا إعادة تسمية أو
  تعديل لجداول `professional_*` وبلا backfill منها.
- تختبر قاعدة فارغة والترقية من baseline السابق على MariaDB 10.11 وMySQL 8.4.
- قبل أول استخدام وفي بيئة معزولة فقط يجوز rollback مدمرًا إذا أثبتت البوابة صفر
  مشاريع ومراحل ومهام وعلاقات وتعليقات ومراجع موافقة/مصروف/فوترة.
- بعد أول سجل يكون الرجوع التشغيلي **read-only** بعقد صريح: يبقى entitlement
  `GENERAL_PROJECTS` وصلاحية `general_projects.view` في `/auth/me`، ويستمر Binary
  متوافق في خدمة GET والتفاصيل والتاريخ. يضبط الخادم feature flag للكتابة إلى
  `GENERAL_PROJECTS_WRITES_ENABLED=false` فتعيد كل mutation خطأ
  `503 FEATURE_TEMPORARILY_READ_ONLY` بلا أثر، ويضبط العميل
  `GENERAL_PROJECTS_NAVIGATION_ENABLED=false` لإخفاء رابط التنقل والأفعال؛ يبقى
  الرابط العميق read-only متاحًا مع تنبيه واضح.
- يمنع إزالة entitlement أو module/permission codes أو نشر Binary أقدم لا يفهمها
  بعد التفعيل. تبقى الجداول والرموز والتدقيق، ثم يعالج السبب بـforward migration
  ويعاد تفعيل الكتابة والتنقل. يمنع إسقاط التعليقات أو الخطة أو إعادة تخصيص رموز
  `GPR-`.

## البدائل المرفوضة

### توسيع `ProfessionalProject` بنوع مشروع داخلي

مرفوض لأنه يربط المشروع العام ضمنيًا بعميل وفوترة وقت وجدار أخلاقي وصلاحيات مهنية،
ويجعل فصل الاستحقاق والواجهة لاحقًا ترحيل بيانات عالي المخاطر.

### إنشاء جدول `projects` مشترك مع type discriminator

مرفوض لأنه يخلق Aggregate متعدد الملاك ويجمع invariants غير متجانسة في Service
واحد، ويجعل كل تعديل في السياقين متداخل النطاق.

### تمثيل المشروع بمركز تكلفة أو فرصة CRM

مرفوض؛ مركز التكلفة بُعد محاسبي، والفرصة حقيقة قبل البيع، ولا يملك أي منهما الخطة أو
المهمة أو التعليق.

### نسخ العميل والموظف والمصروف والفاتورة داخل المشروع

مرفوض لأنه يصنع مصادر حقيقة موازية وتسويات صامتة. الروابط والمجاميع العابرة للسياق
تمر عبر Ports أو Reporting فقط.

### اعتماد حزمة إدارة مشاريع مفتوحة المصدر الآن

مرفوض للمرحلة الأولى: النواة المطلوبة صغيرة وتعتمد حدود وهوية وHR وRBAC وعزل شركة
خاصة بالنظام. إدخال مخطط أو محرك خارجي سيكرر الملاك الحاليين. يعاد تقييم القرار إذا
ظهرت حاجة مثبتة إلى جدولة موارد أو critical path أو Gantt متقدم؛ حينها تطبق سياسة
اعتماد الموديولات وتبقى الحزمة خلف Port/Adapter.

## النتائج

يوفر القرار إدارة مشاريع عامة قابلة للشراء والتطوير بصورة مستقلة، ويحمي السياق
المهني من التحول إلى حاوية لكل عمل. تكلفته إنشاء نماذج وصفحات متوازية للأجزاء التي
تتشابه لفظيًا، لكنها تبقى متباعدة في الملكية والصلاحيات والعقود. أي توحيد عرض مستقبلي
يكون Read Model أو واجهة Portfolio فقط، ولا ينقل الكتابة إلى Aggregate مشترك.
