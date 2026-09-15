---
title: "ADR-027 — Subscription Activation and First Business Outcome Journey"
status: "accepted; implementation not started"
version: "1.0"
date: "2026-09-15"
decision_owner: "Registration & Onboarding with Platform Subscriptions & Entitlements"
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "ADR-003-domain-boundaries-and-eventing.md"
  - "ADR-004-pos-cash-sale-orchestration.md"
  - "ADR-017-platform-subscriptions-entitlements-and-electronic-payments.md"
  - "ADR-019-public-subscription-catalog.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "CHANGE_REVIEW_CHECKLIST_AR.md"
---

# ADR-027: رحلة تفعيل الاشتراك والوصول إلى أول نتيجة عمل

## السياق

المنتج يملك اليوم أجزاء صحيحة لكنها لا تكوّن رحلة تفعيل واحدة:

- يبدأ `RegistrationService` بطلب يحتوي هوية الحساب وبيانات المؤسسة والشركة وملف
  النشاط وقالب الدليل معًا، ثم ينتقل عند التحقق مباشرة إلى `PROVISIONING`.
- ينشئ `CompanyProvisioningService` الشركة والمدير والدليل ومرجعيات Treasury
  واشتراك البداية في معاملة واحدة. يختار الخادم إصدار البداية من
  `PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID`، ولا يقبل اختيار الخطة من عقد
  التسجيل.
- ينقل `/plans` معرف إصدار إلى `/#register?plan=...` كتفضيل متصفح غير موثوق، لكنه
  لا يصبح اختيارًا خادميًا ولا مراجعة ملزمة. بعد الدخول فقط يمكن إعادة حله في مركز
  الاشتراك.
- يملك Platform Subscriptions كتالوجًا مؤرخًا واعتماديات موديولات واستحقاقات
  منفصلة عن RBAC وتغييرات اشتراك idempotent، لكن initial activation ما زال مربوطًا
  بسياسة البداية الخادمة `IMMEDIATE_FREE`.
- توجد فحوص readiness صحيحة لكن متفرقة: ملف الشركة advisory، وTax وSelling Profile
  يملكان readiness خاصة، وPOS يجمع قراءات وجود محدودة في الواجهة ثم يعيد التحقق
  الفعلي داخل أوامر المالكين. لا يوجد عقد خادمي يجمع readiness لكل capability.
- تنفذ POS أول نتيجة مالية كاملة فعلًا عبر Sales وInventory وTreasury وPosting
  Engine في معاملة idempotent، لكنه لا يملك رحلة تهيئة عامة ولا يجوز أن يصبح مالكًا
  لحقائق تلك المجالات.

ينتج عن الوضع الحالي احتمالان غير مقبولين: إما أن يفشل التسجيل كله لأن خطة بداية
خادمة غير مهيأة، أو أن يتلقى المستخدم اشتراكًا وتهيئة لم يراجعهما صراحة. كما لا
يمكن استئناف الرحلة من جهاز آخر اعتمادًا على حالة خادمية دقيقة، ولا يمكن توجيه
الشركة إلى أول نتيجة تناسب الموديولات المختارة دون منطق واجهة متفرق.

## القرار المختصر

تعتمد الرحلة التالية، بهذا الترتيب الحاكم:

```text
Account verification
  -> Company establishment
  -> Plan and module review (dependency closure)
  -> Atomic entitlement provisioning
  -> Dynamic owner-managed setup
  -> Capability-specific readiness
  -> First real business outcome
```

تكون **Registration & Onboarding** هي الـProcess Manager للرحلة فقط. تملك حالة
التنسيق ونسختها وانتقالاتها، ولا تملك أو تنسخ `User` أو `Company` أو الخطة أو
الاستحقاقات أو RBAC أو إعدادات الدومينات أو أول مستند عمل. كل حقيقة تكتبها جهة
مالك واحدة عبر Application Port صغير، ويحتفظ المنسق بمعرفات مرجعية ونتائج خطوات
تقنية منقحة فقط.

الحالة خادمية، versioned، idempotent، وقابلة للاستئناف بعد تبدل التبويب أو الجهاز
أو انقطاع الطلب. لا تكون `localStorage` أو hash أو React state مصدر حقيقة.

هذا القرار يكمل ADR-017 ولا يعتمد سياسة تجربة أو دفع جديدة. لا يمنح `trialDays`
وحده حق تفعيل، ولا يعد نجاح Checkout في المتصفح دليل دفع، ولا يحول خطة مدفوعة إلى
مجانية. السياسة التجارية المنشورة والمقبولة هي وحدها التي تحسم إن كان الطلب
`IMMEDIATE_FREE` أو يحتاج قرارًا/دليل دفع؛ وعند غياب سياسة قابلة للتنفيذ تتوقف
الرحلة صراحة بلا استحقاق.

## الحدود والملكية

| الحقيقة | مالك الكتابة | ما يحفظه Onboarding عنها |
|---|---|---|
| طلب التحقق والرمز وحالة التسليم | Registration & Onboarding | الحقيقة الأصلية نفسها قبل إنشاء الحساب |
| الحساب والجلسات | Identity & Access | `userId` بعد نجاح المنفذ فقط |
| المؤسسة والشركة وملفها | Tenant & Company Configuration | `organizationId/companyId` فقط |
| العضوية والدور والصلاحيات | Identity & Access | لا نسخة؛ نتيجة تقنية `membershipProvisioned=true` داخل انتقال الخطوة فقط |
| مراجعة الخطة والوحدات والسعر | Platform Subscriptions & Entitlements | `activationRequestId` فقط |
| الاشتراك والاستحقاقات | Platform Subscriptions & Entitlements | `subscriptionId` ونسخة النتيجة فقط |
| إعداد موديول | سياق الموديول المالك | `setupTaskId`, `ownerCode`, `ownerReference` وحالة التنفيذ، بلا payload الدومين |
| readiness | كل مالك لقدراته؛ Onboarding يركب القراءة | لقطة تشخيصية منقحة غير حاكمة، ولا boolean دائمًا بديلًا عن القراءة الحية |
| أول نتيجة عمل | سياق الأعمال المالك | نوع مرجع ومعرفه بعد إثباته عبر Query Port، بلا مبلغ أو بنود أو حالة منسوخة |

لا يكتب Onboarding مباشرة في Prisma models لأي مالك. عند الحاجة إلى ذرية بين
checkpoint المنسق وكتابة المالك داخل المونوليث، يمرر `Prisma.TransactionClient`
نفسه إلى Port المالك. لا HTTP داخلي ولا Network I/O داخل المعاملة.

## نموذج الحالة الخادمي

### 1. ما قبل التحقق

يبقى `RegistrationRequest` مالك دورة الرمز والتسليم، لكن يصبح الطلب الأول مقتصرًا
على الحد الأدنى اللازم للحساب: البريد وكلمة المرور/هوية المزود والاسم واللغة. بيانات
الشركة والخطة لا تكون شرطًا لإرسال رابط التحقق. الحالة الحاكمة:

```text
PENDING_VERIFICATION -> VERIFIED
PENDING_VERIFICATION -> EXPIRED | REJECTED
```

`deliveryStatus` مسار تقني مستقل ولا يحول فشل البريد إلى شركة أو اشتراك. يعاد
استخدام `RegistrationVerificationRequested` v1 الحالي عبر Outbox كما هو.

ينشئ الانتقال `VERIFIED`، داخل معاملة واحدة، الحساب لدى Identity و
`OnboardingJourney` ويربطهما بطلب التسجيل. يمحى `passwordHash` من الطلب بعد إنشاء
الحساب بنجاح، ولا تنشأ شركة أو خطة أو استحقاقات أو بيانات تجريبية في هذه الخطوة.

### 2. Aggregate الرحلة

ينشأ Aggregate مملوك لـRegistration & Onboarding:

```text
OnboardingJourney
  id/publicId
  registrationRequestId UNIQUE NULL
  userId
  organizationId NULL
  companyId NULL
  activationRequestId NULL
  stage
  status
  version
  entryChannel
  createdAt/updatedAt/completedAt NULL

OnboardingStepExecution
  id/publicId
  journeyId
  stepCode
  attemptNumber
  status
  idempotencyReference
  ownerCode
  ownerReference NULL
  errorCode NULL
  startedAt/completedAt NULL
  UNIQUE(journeyId, stepCode, attemptNumber)

OnboardingTransition
  id
  journeyId
  fromStage/toStage
  journeyVersion
  reasonCode
  occurredAt
```

`idempotencyReference` بصمة/معرف تقني لا المفتاح الخام. لا يحفظ جدول الخطوات اسم
الشركة أو البريد أو العملة أو الخطة أو السعر أو الموديولات أو حسابات الإعداد. يسجل
`errorCode` من قائمة آمنة، ولا يحفظ رسالة مزود أو stack أو payload.

القيم الحاكمة لـ`stage`:

```text
ACCOUNT_VERIFIED
COMPANY_REQUIRED
PLAN_REVIEW_REQUIRED
COMMERCIAL_DECISION_PENDING
ENTITLEMENTS_PROVISIONED
SETUP_IN_PROGRESS
READY_FOR_FIRST_OUTCOME
FIRST_OUTCOME_IN_PROGRESS
ACTIVATED
```

وقيم `status` المستقلة:

```text
ACTIVE | WAITING | COMPLETED | CANCELLED
```

لا توجد حالة عامة باسم `READY` تغطي النظام كله. قد تكون Capability جاهزة وأخرى
محجوبة، ويصبح `READY_FOR_FIRST_OUTCOME` صحيحًا إذا وجدت نتيجة واحدة مستحقة ومصرحًا
بها وجاهزة يختارها المستخدم. `ACTIVATED` تعني إثبات أول نتيجة حقيقية، لا مجرد
الانتهاء من checklist.

### 3. انتقالات الحالة

| من | الأمر الصريح | الحارس | إلى |
|---|---|---|---|
| `ACCOUNT_VERIFIED` | بدء/استئناف الرحلة | الحساب نشط والجلسة تخصه | `COMPANY_REQUIRED` |
| `COMPANY_REQUIRED` | تأكيد إنشاء الشركة | مدخلات Tenant صالحة ومراجعة ظاهرة | `PLAN_REVIEW_REQUIRED` |
| `PLAN_REVIEW_REQUIRED` | إنشاء مراجعة الخطة | إصدار منشور وسارٍ وclosure صالح | تبقى حتى التأكيد |
| `PLAN_REVIEW_REQUIRED` | تأكيد المراجعة | fingerprint والنسخة والسعر والclosure لم تتغير | `ENTITLEMENTS_PROVISIONED` أو `COMMERCIAL_DECISION_PENDING` |
| `COMMERCIAL_DECISION_PENDING` | استئناف بعد قرار المالك | Subscription owner يثبت approval/evidence | `ENTITLEMENTS_PROVISIONED` |
| `ENTITLEMENTS_PROVISIONED` | بناء خطة الإعداد | قراءة الاستحقاقات الفعلية الحالية | `SETUP_IN_PROGRESS` |
| `SETUP_IN_PROGRESS` | إعادة فحص task أو تخطي optional صراحة | قراءة Port المالك؛ لا تخطي blocker حاكم | تبقى أو `READY_FOR_FIRST_OUTCOME` |
| `READY_FOR_FIRST_OUTCOME` | فتح نتيجة مختارة | entitlement + RBAC + rollout + readiness حية | `FIRST_OUTCOME_IN_PROGRESS` |
| `FIRST_OUTCOME_IN_PROGRESS` | إثبات نتيجة المالك | Query Port يعيد مرجعًا حقيقيًا من الشركة نفسها | `ACTIVATED` |

كل أمر كتابة يحمل `Idempotency-Key` و`expectedJourneyVersion`. إعادة المفتاح والجسم
نفسيهما تعيد النتيجة نفسها، والجسم المختلف يعيد `IDEMPOTENCY_MISMATCH`. النسخة
القديمة تعيد `VERSION_CONFLICT` مع قراءة الرحلة الحالية، ولا يعاد تطبيق المدخلات
القديمة تلقائيًا.

## إنشاء الشركة دون اشتراك خفي

ينشئ أمر الشركة، بعد شاشة مراجعة صريحة، الحقائق الأساسية فقط:

- `Organization/Company/CompanyCurrency/CompanyProfile` عبر Tenant ports.
- `OrganizationMembership/UserCompany` ودور المدير الأول عبر Identity ports.
- Audit في نطاق المنظمة والشركة الصحيحين.

يجوز أن يكون للمستخدم وصول `PLATFORM_FOUNDATION` المحدود لإكمال الاشتراك والإعداد،
لكن لا يحصل على موديول أعمال من RBAC. منح دور المدير لا ينشئ Entitlement، ووجود
Entitlement لا ينشئ Role أو Permission.

لا ينشئ هذا الأمر دليل حسابات أو خزينة أو صنفًا أو عميلًا أو موردًا أو مخزونًا أو
فاتورة أو قيدًا أو سدادًا. تنتقل التهيئة التي تعتمد على الموديولات إلى خطوات
الإعداد بعد تفعيل الاستحقاق. لا تعني هذه القاعدة منع defaults تقنية ثابتة لا تحمل
قيمة أعمال، لكنها تمنع أي كتابة مالية أو مرجعية قابلة للعرض دون إدخال ومراجعة
صريحين.

بعد cutover المحدد أدناه، لا يستدعي مسار V2
`PrismaNewCompanySubscriptionProvisioningAdapter` من داخل إنشاء الشركة، ولا يقرأ
`PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID`. يبقى المسار القديم فقط للشركات أو
الجولات غير المنقولة حتى بلوغ أرضية القطع، ولا يستخدم كـfallback عند فشل V2.

## مراجعة الخطة وDependency Resolver

يكون `PlatformModuleDependencyResolver` مكون Domain/Application واحدًا داخل Platform
Subscriptions. تستعمله كتابة الخطة ونشرها، وإنشاء مراجعة التفعيل، وتطبيقها، وقراءة
الاستحقاق. تزال الخوارزميات المتوازية الحالية بعد اختبارات parity.

مدخل الحل:

```text
companyId
targetPlanVersionId
explicitOptionalModuleIds[]
effectiveAt
```

ونتيجته الحتمية:

```text
planVersionId/versionNumber
resolvedModules[] sorted topologically then by code
  moduleId/code
  origin = INCLUDED | USER_SELECTED | DEPENDENCY_OF(moduleCode)
  selectionMode
  additionalRecurringFee
quote(currencyCode, baseRecurringFee, optionalRecurringFee, totalRecurringFee)
reviewFingerprint
```

قواعده:

1. الإصدار منشور وسارٍ وغير متقاعد وخطته نشطة، ولا يقبل معرفًا من المتصفح كدليل
   أهلية.
2. يرفض cycle أو موديولًا غير نشط/غير معروف أو dependency خارج ما يتيحه إصدار
   الخطة.
3. تكون INCLUDED closure كاملة داخل INCLUDED؛ لا يعتمد موديول مشمول على اختيار
   اختياري غير مؤكد.
4. عند اختيار Optional، يضيف resolver dependencies الاختيارية المتاحة إلى
   **المراجعة** ولا يمنحها بعد. تظهر الإضافة وسببها ورسومها، ثم يحتاج fingerprint
   جديدًا وتأكيدًا صريحًا. لا dependency مجانية أو مدفوعة مخفية.
5. لا يفسر `null` بأنه صفر، ولا يحول Decimal إلى Number، ولا يجمع عملات مختلفة.
6. لا يثق في سعر أو اسم أو closure يعيدها المتصفح؛ يعاد الحل والقفل عند التأكيد.

تملك Platform Subscriptions سجل مراجعة/تفعيل أولي مستقلًا عن Onboarding:

```text
PlatformSubscriptionActivationRequest
  id/publicId/companyId UNIQUE-active
  activeSlot = 1 for active states, NULL for terminal states
  targetPlanVersionId
  state = REVIEWED | PENDING_DECISION | APPROVED | REJECTED | APPLIED | CANCELLED
  reviewFingerprint
  quote snapshot
  expectedCompanySubscriptionVersion = 0
  requestedById/decidedById NULL
  version

PlatformSubscriptionActivationModule
  activationRequestId/moduleId/origin/selectionMode/feeSnapshot
```

هذه حقائق يملكها سياق الاشتراك، وليست نسخًا لدى Onboarding. السعر والclosure لقطة
مراجعة immutable للتدقيق، ويعاد الحل قبل التطبيق. لا تنشأ حالة `PlatformSubscription`
مصطنعة من أجل طلب لم يعتمد بعد.

ينفذ شرط «طلب نشط واحد للشركة» على MySQL/MariaDB بتفرد
`(companyId,activeSlot)`؛ تحمل الحالات `REVIEWED/PENDING_DECISION/APPROVED` القيمة
`1`، وتتحول إلى `NULL` في `REJECTED/APPLIED/CANCELLED` كي يسمح التاريخ بعدة صفوف
نهائية. إنشاء مراجعة بديلة يلغي القديمة ويحرر slot في المعاملة نفسها، ولا يعتمد
على partial index غير مدعوم.

## السياسة التجارية وعدم اختراع trial/payment

- `IMMEDIATE_FREE` يطبق فقط إذا كان الرسم الأساسي وكل الرسوم الناتجة صفرًا صريحًا،
  وكانت سياسة الإصدار المنشورة تسمح بذلك. يظل تأكيد المراجعة مطلوبًا.
- `REQUEST_ONLY` أو أي إجمالي موجب ينتقل إلى `COMMERCIAL_DECISION_PENDING`. لا تنشأ
  استحقاقات ولا `ACTIVE/TRIALING` تلقائيًا.
- `trialDays > 0` معلومة كتالوج وليست إذن تفعيل. لا يبدأ trial إلا إذا أعاد
  `SubscriptionActivationPolicyPort` قرارًا معتمدًا صريحًا يحدد eligibility و
  `effectiveAt/trialEndsAt` ومصدر القرار. حتى اعتماد ذلك يبقى الطلب منتظرًا.
- لا يعيد Onboarding تنفيذ Checkout أو Webhook، ولا يقبل نجاحًا من المتصفح. عند
  اشتراط دفع يستخدم Subscription owner دليلًا من
  `PlatformSubscriptionPaymentEvidencePort` وفق ADR-017.
- لا proration أو chargeback أو partial refund أو اشتراك مؤسسة أو تمديد trial بهذا
  القرار. غياب Adapter/سياسة معتمدة يعيد `COMMERCIAL_POLICY_UNAVAILABLE` ويترك
  الطلب قابلًا للاستئناف بلا أثر جزئي.

## التفعيل الذري للاستحقاقات وفصل RBAC

بعد قرار تجاري صالح ينفذ سياق الاشتراك معاملة واحدة تشمل:

```text
Idempotency record
-> Company row
-> activation request
-> PlanVersion
-> PlatformModule rows in ascending id
-> PlatformSubscription
-> PlatformSubscriptionEntitlement rows for the resolved closure
-> initial PlatformSubscriptionChange history
-> activation request = APPLIED
-> Audit
-> Onboarding checkpoint (through the process-manager port)
-> commit
```

إما أن تظهر كل الاستحقاقات والاشتراك والتاريخ والـcheckpoint معًا أو لا يظهر شيء.
تفرد `companyId` دفاع إضافي ولا يستبدل قفل الشركة وIdempotency والنسخة. يجب أن تستخدم
كل مسارات إنشاء/تغيير اشتراك الشركة ترتيب القفل نفسه قبل cutover؛ لا يضاف ترتيب
خاص لمسار التسجيل.

لا تكتب المعاملة `Role`, `Permission`, `RolePermission` أو `UserCompanyRole`.
الحساب الفعلي للقدرة يبقى:

```text
company entitlement
  ∩ user RBAC permission
  ∩ rollout/feature safety gate
  ∩ live domain readiness for the attempted command
```

يفشل API مغلقًا إذا غاب أي ضلع. لا تكون إتاحة زر أو route دليل سماح.

## الإعداد الديناميكي

يقرأ Onboarding الاستحقاقات الفعلية من Subscription Query Port، ثم يبني DAG مهام
من Registry versioned في الشفرة. لا يحفظ قائمة موديولات موازية ولا يبني مهام من
قيم متصفح. كل تعريف يحتوي:

```text
taskCode
policyVersion
requiredEntitlements[]
dependsOnTaskCodes[]
ownerCode
requiredPermission
setupActionId
readinessCapabilityCodes[]
required | optional
```

النسخة الأولى للـRegistry تربط القدرات التالية، ولا تدعي اكتمالًا عامًا:

| Capability | المالك | blockers الحاكمة قبل أول نتيجة | أول نتيجة موجهة |
|---|---|---|---|
| `CORE_ACCOUNTING.POST_MANUAL_JOURNAL` | Core Accounting | دليل صالح، تعيينات مطلوبة، سنة/فترة مفتوحة | قيد يدوي حقيقي ينشئه ويؤكده المستخدم |
| `SALES.POST_INVOICE` | Sales/AR | عميل فعلي، حساب ذمة، فترة، عملة، حسابات/ضريبة صالحة | فاتورة مبيعات حقيقية؛ لا ترحيل تلقائي |
| `PURCHASES.POST_INVOICE` | Purchases/AP | مورد فعلي، حساب ذمة، فترة، عملة، حساب/ضريبة صالحان | فاتورة مشتريات حقيقية |
| `TREASURY.POST_RECEIPT` | Treasury | صندوق/بنك وطريقة دفع وفترة وعملة وطرف فعلي | سند قبض حقيقي |
| `INVENTORY.POST_MOVEMENT` | Inventory | مستودع ووحدة وصنف وتعيينات تقييم؛ رصيد افتتاحي صريح عند الحاجة | حركة مخزون حقيقية يراجعها المستخدم |
| `POS.COMPLETE_CHECKOUT` | POS كمنسق | readiness الحية لـSales+Inventory+Treasury+Core؛ عميل وصنف وبيع ومخزون وأداة قبض وفترة | Checkout حقيقي واحد عبر المسار القائم |
| `REPORTING.VIEW_FINANCIAL_REPORT` | Reporting | قدرة القراءة ومصدر دفتر صالح؛ يسمح بحالة صفرية صادقة | فتح تقرير مشتق من البيانات الحقيقية |
| `DATA_IMPORT.COMMIT_BATCH` | Data Import | قالب ومعاينة وعقود المالكين المستهدفين | اعتماد دفعة حقيقية بعد preview صريح |
| `APPROVALS.DECIDE_SUBJECT` | Approvals | موضوع حقيقي مؤهل وMaker/Checker مختلفان | قرار على موضوع حقيقي، لا طلب تجريبي |
| `PROFESSIONAL_PROJECTS.CREATE_PROJECT` | Professional Projects | عميل ووصول وعملة وسياسة تضارب عند الصلة | مشروع/قضية حقيقية |
| `HUMAN_RESOURCES.CREATE_EMPLOYEE` | Human Resources | هيكل أدنى وصلاحية المدير | موظف حقيقي بلا راتب أو حساب بنكي مختلق |
| `TAX.CONFIGURE_RATE` | Tax | ولاية/قرار ضريبي صريح وحسابات مؤهلة | إعداد معدل حقيقي؛ لا معدل افتراضي تخميني |
| `CRM.CREATE_LEAD` | CRM | Sales entitlement وهوية مسؤول عند الإسناد | عميل محتمل حقيقي |
| `SERVICE_CATALOG.CREATE_OFFERING` | Service Catalog | سياقه منفذ ومتاح وسياسة تسعير صريحة | خدمة فعلية؛ يبقى `UNAVAILABLE` حتى تنفيذ السياق |

وجود Entitlement لا يجعل المهمة `required` تلقائيًا إذا كانت النتيجة المختارة لا
تحتاجها. مثال: يمكن مشاهدة تقرير صفري بلا إنشاء قيد، لكن لا يمكن POS checkout دون
closure الكامل وreadiness الحية. يختار المستخدم مسار النتيجة؛ لا ينشئ النظام جميع
البيانات المرجعية لكل الموديولات مقدمًا.

لا يستخدم النظام fixtures أو demo seeds في أي بيئة عميل. لا ينشئ تلقائيًا عميلًا
نقديًا أو صنفًا أو مخزونًا أو فاتورة أو Receipt أو Payment أو Journal Entry. كل
كتابة مالية تمر بشاشة مراجعة وأمر المالك وصلاحياته وIdempotency وحواجزه المعتادة.

لا يمرر Onboarding أجسام أوامر الإعداد إلى المالكين. يفتح route المالك، ينفذ
المستخدم أمره من عقد المالك القائم، ثم يعيد Onboarding قراءة readiness. بذلك لا
يصبح endpoint الرحلة gateway ينسخ OpenAPI أو validation أو Audit الموديول.

## عقد readiness لكل Capability

يكشف كل مالك `CapabilityReadinessPort` بقراءة مقيدة بالشركة. يركب Onboarding النتائج
لكنه لا يعيد تفسير قواعدها:

```text
CapabilityReadiness
  capabilityCode
  ownerCode
  policyVersion
  status = READY | BLOCKED | NOT_APPLICABLE | UNAVAILABLE
  blockers[]
    code
    severity = BLOCKING | ADVISORY
    setupActionId NULL
  evaluatedAt
```

قواعد العقد:

- `READY` تعني أن متطلبات البدء المعروفة الآن مكتملة، وليست وعدًا بأن أمرًا ماليًا
  مستقبلًا سينجح؛ يعيد الأمر الحاكم التحقق داخل معاملته.
- `NOT_ENTITLED` و`NOT_AUTHORIZED` حالتا composition خارج Port الدومين ولا يطلب
  المنسق تفاصيل readiness المخفية إذا لم يملك الفاعل حق قراءتها.
- لا تعيد blockers معرفات موارد أو أسماء أطراف أو أرصدة. `setupActionId` قيمة من
  Registry موثوق وليست URL؛ الواجهة تحولها إلى route محلي مسموح بعد فحص RBAC.
- فشل Port أو timeout لا يفسر كـREADY؛ يعاد `UNAVAILABLE` مع retry آمن للقراءة.
- القراءة batch وبميزانية استعلام معلنة. لا N+1 لكل بطاقة ولا جمع عملات أو مبالغ.
- لا تخزن نتيجة readiness كمصدر حقيقة. يجوز حفظ transition «لوحظت جاهزة» ووقت
  القياس للتحليلات، ثم تعاد القراءة قبل أول نتيجة.

تستبدل هذه القراءة التجميعية probes الواجهة كدليل رحلة، لكن لا تحذف قراءات POS
المحدودة حتى ينقل مستهلكها باختبارات parity. تظل `DatabaseReadinessService` فحص
تشغيل للبنية، وليست readiness أعمال.

## أول نتيجة عمل

يعرض المنسق النتائج المتاحة مرتبة باختيار المستخدم والموديولات، لا بأولوية تسويقية
مخفية. يفتح `setupActionId/outcomeActionId` route قائمًا ويترك الأمر لسياق المالك.
لا يمرر payload جاهزًا ولا يضغط زرًا ولا يرحل مستندًا نيابة عن المستخدم.

عند العودة أو الاستئناف، يستدعي `FirstOutcomeQueryPort` لدى المالك بالـ`companyId`
و`activatedAfter`. يعيد المرجع الأدنى `{ownerCode, outcomeType, aggregateId,
occurredAt}` إذا كان الفاعل يملك حق رؤيته. يحفظ Onboarding المرجع فقط ويكمل
`ACTIVATED`. بالنسبة إلى POS تكون النتيجة `PosSale` قائمًا مرتبطًا بفاتورة وReceipt
حقيقيين؛ لا ينسخ المنسق المبلغ أو البنود أو أرقام المستندات.

لا يضيف هذا القرار Eventًا إلى كل موديول لمجرد اكتشاف أول نتيجة. يمكن لاحقًا ربط
حدث قائم أو Projection عندما يوجد مستهلك حقيقي، لكن query المملوك هو عقد الشريحة
الأولى ويمنع إنشاء Outbox غير مستخدم.

## الأحداث والتدقيق

| الحقيقة | الآلية | القرار |
|---|---|---|
| طلب إرسال تحقق | `RegistrationVerificationRequested` v1 عبر Outbox | يبقى كما هو، payload بلا بريد أو رمز |
| انتقال journey | `OnboardingTransition` داخل معاملة checkpoint | سجل process داخلي append-only، ليس Event Bus ولا Audit بديلًا |
| إنشاء/تفعيل الاشتراك | Audit وسجل `PlatformSubscriptionChange` لدى المالك | لا Outbox جديد في الشريحة الأولى لغياب مستهلك |
| اكتمال setup task | checkpoint + Audit المالك عند وجود كتابة | لا حدث عام ينسخ payload الإعداد |
| أول نتيجة | حقيقة المالك + مرجع Onboarding | لا تعديل Audit/جدول المالك ولا حدث مصطنع |
| اكتمال الرحلة | `OnboardingJourneyCompleted` v1 | يضاف فقط مع مستهلك تحليلات durable معروف؛ وإلا يبقى transition داخليًا |

إذا نفذ الحدث الأخير، يكتب Outbox في معاملة `ACTIVATED` ويحمل فقط
`eventId,eventType,schemaVersion,aggregateId,companyId,entryChannel,occurredAt`؛ لا
يحمل userId أو بريدًا أو أسماء أو خطة أو مبلغًا. يكون المستهلك idempotent مع
retry/dead-letter/retention وفق ADR-003.

## التزامن وIsolation والمهل

- تستخدم أوامر الرحلة `IdempotentCommandExecutor` و`TransactionExecutor` المركزيين.
- التفعيل الأولي واختبارات التنافس يعملان على MySQL 8.4 وMariaDB 10.11؛ mocks لا
  تثبت قفل الصف أو Serializable.
- لا يغير هذا ADR Isolation العام. تستخدم عمليات الانتقال التي تنشئ عدة حقائق
  `Serializable` حتى تثبت القياسات مستوى أقل، مع baseline أمر كتابة 15 ثانية و
  `maxWait=2s/timeout=8s`. يجوز لإنشاء الشركة المركب استعمال نافذته الحالية الأكبر
  ضمن request deadline واحد موثق.
- ترتيب القفل العام: Idempotency، ثم User/Company حسب الخطوة، ثم Journey، ثم
  Aggregate المالك وموارده بترتيبه، ثم transition/Audit/Outbox. عند تفعيل الاشتراك
  يطبق الترتيب المتخصص المبين أعلاه على كل الكتاب الحاليين.
- تقفل عدة معرفات موديول تصاعديًا. resolver نفسه نقي ولا يقفل؛ يعاد الحل بعد الأقفال
  قبل الكتابة.
- لا Retry لأخطاء الأعمال أو RBAC أو plan stale أو version conflict. تعاد المعاملة
  كاملة فقط لأخطاء DB العابرة المصنفة وضمن deadline واحد.
- طلبان متزامنان لنفس الخطوة: واحد يرفع `journey.version`، والآخر replay أو 409 بلا
  أثر ثان. طلب تفعيل وطلب تغيير مشغل متزامنان يتسلسلان على Company/Subscription؛
  لا اشتراكان ولا entitlement intervals متداخلان.
- لا sleep أو بريد أو دفع أو API خارجي داخل transaction. عند انقطاع العميل لا يبدأ
  عمل جديد، وتبقى نتيجة ملتزم بها قابلة للاستعادة عبر GET ومفتاح Idempotency.

## العزل والأمان والخصوصية

- كل Query بعد إنشاء الشركة مقيد بـ`companyId` من الجلسة والخادم، لا من body أو
  رابط. يطابق Journey المستخدم والشركة والعضوية في كل استئناف.
- قبل الشركة، لا يقبل `userId` من العميل؛ يشتق من جلسة الحساب المتحقق.
- لا تمنح عضوية Organization أو دور منصة أو plan link وصول شركة. يبقى UserCompany
  وRBAC والاستحقاق شروطًا مستقلة.
- لا يكشف public catalog شركة أو اشتراكًا. يعاد plan intent من الخادم ويطلب مراجعة؛
  لا يحفظ في RegistrationRequest كعقد شراء.
- لا تحفظ الرموز أو كلمات المرور أو البريد أو IP الخام في transition أو analytics.
  يبقى token hash فقط وسياسة تسجيل/احتفاظ Registration الحالية، ويمحى password hash
  بعد إنشاء الحساب.
- تحجب readiness تفاصيل موارد لا يستطيع المستخدم قراءتها. تعيد blocker عامًا مع
  طلب الرجوع إلى مدير مخول بدل كشف اسم حساب أو مستند.
- تنظف StepExecution/Transition التفصيلية بعد مدة الاحتفاظ التشغيلي المعتمدة
  للتسجيل؛ تحفظ المقاييس المجمعة منزوعة الهوية. لا يضاف احتفاظ دائم جديد قبل قرار
  Privacy/Compliance صريح.
- كل JSON تحت `/api/v1` يحمل `Cache-Control: no-store`، وتبقى CSRF وrate limits
  للمسارات العامة والحساسة كما هي.

## التحليلات والرصد

المطلوب قياس funnel بلا مصدر حقيقة موازٍ وبلا PII:

- `onboarding_stage_transition_total{from,to,entry_channel}`.
- `onboarding_stage_duration_seconds{stage,entry_channel}`.
- `onboarding_resume_total{stage}`.
- `onboarding_step_failure_total{step_code,error_class}`.
- `onboarding_review_stale_total` و`onboarding_dependency_added_total{module_code}`.
- `onboarding_capability_blocked_total{capability_code,blocker_code}`.
- `onboarding_first_outcome_total{outcome_type}` وtime-to-first-outcome.
- transaction duration/deadlock/retry/exhaustion/deadline وفق السياسة المركزية.

لا تستخدم `companyId/userId/journeyId/planId` كـmetric labels. قد تحمل السجلات
المنظمة correlation reference مبصومًا قصير العمر، ولا تحمل البريد أو الاسم أو
المبلغ أو idempotency key الخام. لا ترسل analytics إلى طرف خارجي بهذا ADR.

## حدود الفشل والاستئناف

| الفشل | الأثر | الاستئناف |
|---|---|---|
| البريد لم يرسل | لا حساب/شركة | resend القائم؛ بلا كشف وجود الحساب |
| التحقق نجح وإنشاء الحساب فشل | rollback كامل | إعادة الرابط ضمن صلاحيته أو طلب جديد |
| الحساب أنشئ وانقطع الرد | الحساب وJourney checkpoint معًا | GET journey بعد الدخول؛ لا إنشاء ثانٍ |
| إنشاء الشركة فشل | لا Company ولا عضوية شركة ولا checkpoint | تصحيح المدخل وإعادة المفتاح/أمر جديد |
| انقطع الرد بعد إنشاء الشركة | النتيجة وcheckpoint ذريان | GET journey يعيد `PLAN_REVIEW_REQUIRED` |
| الخطة تغيرت بعد المراجعة | لا اشتراك | `REVIEW_STALE` ثم مراجعة وتأكيد جديدان |
| قرار تجاري/دفع غير متاح | لا Entitlement | `COMMERCIAL_DECISION_PENDING` أو خطأ policy صريح |
| أي insert أثناء التفعيل فشل | لا Subscription/Entitlements/Change/checkpoint | إعادة الأمر نفسه بعد إصلاح السبب |
| setup task فشلت | لا تراجع خطوات صحيحة سابقة | تبقى task قابلة للإعادة؛ مالكها يضمن ذرية أمره |
| readiness Port تعطل | لا READY مصطنع | `UNAVAILABLE` وretry قراءة يدوي/محدود |
| أول أمر عمل فشل | rollback وفق المالك؛ Journey لا يكتمل | يعود إلى readiness ويفتح الأمر نفسه |
| أول أمر نجح وانقطع الرد | حقيقة العمل محفوظة ولا تعاد تلقائيًا | Query Port يثبتها ثم يكمل Journey |

لا تستخدم compensating delete لشركة أو حساب أو بيانات إعداد صحيحة لمجرد فشل خطوة
لاحقة. الاستئناف إلى الأمام هو الأصل؛ الإلغاء يوقف الرحلة ولا يحذف حقائق المالكين.

## عقود HTTP المستهدفة

كل الأجسام تحرس من OpenAPI المولد، ومعرفات BIGINT نصوص:

```text
POST /auth/register                         // account minimum only
POST /auth/register/verify                  // creates verified account + journey
GET  /onboarding/journey
POST /onboarding/company                    // expectedJourneyVersion + reviewed company input
POST /onboarding/subscription/reviews       // creates owner review snapshot
POST /onboarding/subscription/confirm       // reviewId/fingerprint + expected versions
GET  /onboarding/setup
POST /onboarding/setup/{taskCode}/recheck   // no domain payload; reads owner readiness
GET  /onboarding/readiness
POST /onboarding/outcome-selection          // navigation intent only, no business write
POST /onboarding/complete                   // rechecks owner outcome and checkpoints
```

يحتاج كل POST بعد التحقق جلسة وCSRF وIdempotency-Key، ويعيد `journeyVersion`.
لا يقبل أي عقد `companyId`, `userId`, price, entitlement, permission, readiness
boolean أو outcome aggregateId من المتصفح كمصدر حقيقة. يستطيع GET إعادة
`allowedActions` وblocker/action codes فقط.

الأخطاء العامة الثابتة: `409` لـ`VERSION_CONFLICT/IDEMPOTENCY_*` وstale review،
`422` لمدخل أو انتقال أو dependency غير صالح، `403` لفشل RBAC/entitlement، `503`
لـowner أو commercial policy غير المتاح وretry exhaustion، و`504` لانتهاء deadline.
لا تظهر أخطاء Prisma أو MySQL أو سبب عدم أهلية حساب آخر.

## شرائح التنفيذ الملزمة

لا تجمع الشرائح التالية في تغيير واحد. كل شريحة مستقلة Migration/عقود/اختبارات
ورجوع، ولا تبدأ شريحة تالية قبل اجتياز سابقتها بوابتي قاعدة البيانات.

### SAJ-0 — توحيد resolver بلا تغيير سلوك

النطاق المتوقع:

- `apps/api/src/platform-subscriptions/platform-module-dependency-resolver.ts` جديد.
- نقل المنطق من `new-company-start-policy.ts` و`platform-subscription-service.ts` و
  `prisma-company-entitlement-query-adapter.ts` إلى المكون الواحد.
- اختبارات unit/property للـDAG وparity مع SUB-1..3.

القبول: لا عقد ولا Schema ولا نتيجة اشتراك تتغير؛ cycle/missing/inactive والـsorting
الحتمي والـDecimal مغطاة. الرجوع إعادة الكود السابق فقط.

### SAJ-1 — الحساب المتحقق وJourney state machine

النطاق المتوقع:

- Migration توسعية لـ`OnboardingJourney/StepExecution/Transition` وعلاقات
  `RegistrationRequest`.
- `apps/api/src/onboarding/**` للـaggregate/repository/process manager/router.
- فصل جسم Registration في OpenAPI والواجهة إلى account minimum، وتحديث social
  onboarding لنقطة الدخول نفسها.
- لا Company ولا Subscription في verify.

القبول: verify متزامنان ينشئان User/Journey واحدين؛ replay وexpired token وانقطاع
الرد وprivacy/retention وcross-user tests. الرجوع يبقي الجداول ولا يسقطها.

### SAJ-2 — خطوة Company مستقلة

النطاق المتوقع:

- استخراج `CompanyBootstrapPort` من `CompanyProvisioningService` دون Subscription أو
  Accounting/Treasury setup.
- عقد `/onboarding/company` وواجهة مراجعة الشركة.
- Foundation access ضيق للمالك الجديد واختبارات تمنع فتح business routers.

القبول: company+membership+Audit+checkpoint ذرية؛ لا plan/entitlement/chart/treasury
ولا أي جدول مالي. نفس المفتاح/جسم يعيد النتيجة، ومفتاح مختلف متزامن لا ينشئ شركتين.

### SAJ-3 — مراجعة وتفعيل الاشتراك

النطاق المتوقع:

- Migration توسعية لـ`PlatformSubscriptionActivationRequest/Module`.
- Ports وسياسة activation ومراجعة/تأكيد في Platform Subscriptions، ثم adapters في
  Onboarding composition فقط.
- OpenAPI/واجهات review توضح dependency additions والسعر والسياسة والتجربة كحقيقة
  غير مفعلة.
- إزالة استدعاء start-plan من **مسار V2 فقط** بعد تفعيل cohort.

القبول: stale review، رسوم dependency، IMMEDIATE_FREE، REQUEST_ONLY، إجمالي موجب،
غياب payment/trial policy، atomic failure في كل نقطة، race مع operator change، RBAC
parity، entitlement enforcement المباشر، وعزل شركتين على MySQL/MariaDB.

### SAJ-4 — Registry الإعداد وreadiness الخادمية

النطاق المتوقع:

- `apps/api/src/onboarding/setup-registry.ts` versioned.
- `CapabilityReadinessPort` في المالكين وcomposition aggregator batch.
- البدء بـCore Accounting وSales وInventory وTreasury وPOS، ثم بقية الموديولات في
  نفس registry بحالة `UNAVAILABLE` حتى يمتلك كل منها Port مختبرًا؛ لا READY وهمي.
- استبدال دليل `retail-onboarding-read.ts` تدريجيًا مع parity، لا حذف مفاجئ.

القبول: task graph حسب entitlement، RBAC redaction، owner failure/timeout، query
budget، no N+1، لا حفظ domain facts، وإعادة تحقق أوامر المالك داخل transaction.

### SAJ-5 — أول نتيجة فعلية وإكمال الرحلة

النطاق المتوقع:

- `FirstOutcomeQueryPort` لكل outcome مدعوم، والبدء بـPOS وSales وCore Accounting.
- outcome chooser في System Home يعتمد capabilities الفعلية.
- لا business POST من Onboarding؛ navigation ثم recheck فقط.

القبول: صفر demo writes، نتيجة من شركة أخرى لا تكمل، نتيجة قبل `activatedAfter` لا
تكمل، success+lost-response يستأنف، وPOS يثبت `PosSale` وفاتورة وReceipt مرة واحدة.

### SAJ-6 — Cutover والتوافق وإزالة المسار الخفي

النطاق المتوقع:

- نقل self-registration وsocial onboarding أولًا، ثم group-company onboarding إلى
  `Company -> Plan` نفسه دون إعادة Account verification.
- إيقاف الاعتماد التشغيلي على `PLATFORM_SUBSCRIPTION_START_PLAN_VERSION_ID` بعد
  بلوغ أرضية القطع؛ يبقى grandfathering للـmigration فقط.
- E2E حقيقي لكل entry channel، وrunbook استئناف/تعطيل intake/metrics.

القبول: لا شركة V2 تستدعي fallback القديم، ولا شركة قائمة يتغير اشتراكها، وكل Journey
نشطة تكمل على binary journey-aware مثبت.

## مصفوفة الاختبارات الإجمالية

### Unit وcontracts

- كل انتقال مسموح/ممنوع، CAS للنسخة، fingerprint حتمي، وأكواد الأخطاء.
- dependency closure: chain/diamond/cycle/missing/inactive/optional fee/stale plan.
- Registry: DAG بلا cycle، كل action/capability/permission/module code معروف، وparity
  API/Web لخريطة Entitlement.
- OpenAPI generated guards وresponse validation وBIGINT/Decimal النصيين وno-store.

### Integration على قاعدة فعلية

- verify مرتين، company create مرتين، activation مقابل operator change، وتأكيدان
  للمراجعة نفسها.
- fault injection بعد كل كتابة في entitlement transaction يثبت rollback الكامل.
- replay بعد commit وانقطاع الرد، mismatch، retry exhausted، deadline، وP2002 ليس
  deadlock.
- company/user/activation/readiness/outcome cross-company وcross-user.
- Migration من قاعدة فارغة ومن baseline المنشور وrollback تطبيقي على MariaDB 10.11
  وMySQL 8.4.

### E2E

- بريد/password وGoogle/Apple الموثوقان يصلان إلى Journey نفسها دون ربط بالبريد.
- خطة مجانية صريحة: Account -> Company -> review -> entitlement -> setup -> نتيجة.
- خطة `REQUEST_ONLY` أو مدفوعة تتوقف دون Entitlement حتى دليل/قرار معتمد.
- استئناف بعد كل stage من تبويب/جهاز آخر، وفقد الجلسة يعيد الدخول ولا يفقد الحالة.
- POS: dependencies ظاهرة، readiness ناقصة علاجية، ثم checkout حقيقي واحد؛ failure
  لا يترك Invoice/Receipt/Movement/Ledger جزئيًا.
- RTL/LTR والهاتف واللمس، مع عدم فتح روابط أو actions غير مخولة.

### أمن وخصوصية وتحليلات

- لا token/password/email/name/amount/idempotency raw في Outbox أو transition أو
  logs أو metrics.
- enumeration/rate-limit/CSRF/session invalidation كما في سياسات Identity.
- analytics deduplicated على transition version، ولا high-cardinality identifiers.
- retention cleanup لا يحذف Journey نشطة أو Idempotency protection لازمة.

## النشر والرجوع

الانتقال expand/contract، ولا يوجد dual write إلى مصدرين للحقيقة:

1. تنشر الجداول والـresolver وقراءات shadow بلا إتاحة Journey V2.
2. تفعّل cohort داخليًا بعد بوابتي DB وE2E؛ الرحلة التي بدأت V1 تكمل V1، والتي بدأت
   V2 تثبت `journeySchemaVersion=2` وتكمل V2 فقط.
3. قبل أول إنشاء شركة V2 تكون أرضية الرجوع `PRE_V2_COMPANY`: يجوز تعطيل V2 والعودة
   إلى binary السابق للطلبات الجديدة.
4. بعد أول `COMPANY_REQUIRED -> PLAN_REVIEW_REQUIRED` ملتزم تصبح الأرضية
   `JOURNEY_AWARE_REQUIRED`: لا يجوز تشغيل binary لا يفهم شركة بلا اشتراك أو Journey
   غير مكتملة. الرجوع إلى last-known-good V2-aware فقط، مع تعطيل intake الجديد
   واستمرار GET/resume للرحلات القائمة.
5. لا يسقط rollback.sql جداول Journey/Activation أو Transition/Idempotency/Audit،
   ولا يحذف شركة أو اشتراكًا أو استحقاقًا. تجمد mutations الجديدة أثناء rollback
   ثم يعاد فحص invariants والـreadiness قبل الفتح.
6. يزال مسار start-plan الخفي ومتغير البيئة فقط بعد صفر رحلات V1 نشطة وتثبيت دليل
   أرضية القطع. لا يعاد grandfathering كـfallback.

إذا تعطل إصدار V2 بعد تفعيل استحقاقات، تبقى القدرات الفعلية محكومة بالاشتراك وRBAC
ولا تسحب. إذا تعطل قبل التفعيل، تبقى الشركة في Foundation access وتستأنف عند تعافي
المنسق. لا rollback تجاري تلقائي ولا إلغاء اشتراك بسبب عطل Onboarding.

## البدائل المرفوضة

### الاستمرار بخطة بداية خادمة واحدة

مرفوض للرحلة المستهدفة لأنه يخفي الاختيار ولا يدعم العملات والسياسات المختلفة،
ويجعل تعطل إعداد تشغيلي يفشل التحقق والشركة معًا. يبقى فقط توافقًا انتقاليًا.

### ربط الموديولات بالأدوار

مرفوض لأن RBAC قرار مستخدم داخل شركة، والاستحقاق قرار تجاري للشركة. دمجهما يسمح
بدور بلا اشتراك أو يسحب صلاحيات تاريخية عند تغيير الخطة.

### حفظ كل بيانات الخطوات في Onboarding

مرفوض لأنه ينشئ مصدر حقيقة موازٍ للشركة والخطة والإعداد والمستند. المنسق يحتفظ
بمراجع وcheckpoint فقط ويسأل المالك عند العرض والاستئناف.

### إنشاء demo أو defaults مالية لإظهار النجاح

مرفوض لأنه قد يلوث Ledger والمخزون والذمم والتقارير ويجعل المستخدم يثق بنتيجة غير
حقيقية. empty state الصادق أفضل من فاتورة أو رصيد أو دفع مختلق.

### Event choreography بين كل خطوة

مرفوض في الشريحة الأولى؛ invariants المطلوبة قبل الانتقال تستخدم Ports ومعاملات
محلية. يضاف Outbox فقط لأثر بعد commit له مستهلك معروف.

### معاملة واحدة من التحقق حتى أول نتيجة

مرفوض لأنها تعبر قرارات بشرية ودفعًا محتملًا وتسبب أقفالًا طويلة ولا يمكن استئنافها.
الذرية مطلوبة داخل كل خطوة، وبخاصة entitlement provisioning والأوامر المالية، لا
عبر الرحلة الزمنية كلها.

## أثر الباركود وقنوات الهاتف

القرار يؤثر على توجيه إعداد POS واختيار الصنف، لذلك ليس `N/A`. لا ينشئ Barcode
model أو parser أو lookup جديدًا. Inventory يبقى مالك الهوية والحل، وPOS/Sales
يستهلكان المنافذ القائمة. readiness لا تدعي أن وجود صنف يثبت وجود باركود أو سعر أو
مخزون كافٍ. يجب على SAJ-4/5 الحفاظ على إدخال HID واليدوي وحد scanner الحالي، وعلى
العزل وRBAC والتأكيد، وتشغيل بوابة الباركود الحالية ومصفوفة أجهزة الهاتف ذات الصلة
إذا عدلت تلك الشرائح الإدخال أو الإخراج. لا QR URL تلقائي ولا طباعة/درج نقد جديد
بهذا القرار.

## النتائج

### إيجابية

- رحلة صادقة قابلة للاستئناف من التحقق إلى قيمة أعمال حقيقية.
- اختيار ومراجعة واضحان للخطة والاعتماديات بلا رسوم أو تجربة أو دفع خفي.
- Entitlements ذرية ومنفصلة تنظيميًا وتقنيًا عن RBAC.
- إعداد موجه فقط لما يحتاجه الموديول والنتيجة المختاران.
- readiness قابلة للعلاج ولا تتحول إلى مصدر حقيقة موازٍ.
- فشل خطوة لا يمحو حقائق صحيحة ولا يترك اشتراكًا أو أثرًا ماليًا جزئيًا.

### تكاليف ومخاطر

- Migration وحالة Process Manager وواجهات جديدة، مع فترة تعايش V1/V2 محدودة.
- ضرورة توحيد dependency resolver وتحديث ترتيب أقفال كل كتاب الاشتراك.
- إنشاء Company قبل Subscription يفرض Foundation access ضيقًا وbinary rollback
  journey-aware بعد أرضية القطع.
- اكتمال readiness يحتاج Ports صغيرة من عدة مالكين ويجب منعه من التحول إلى
  orchestrator ضخم أو query N+1.

## حالة التطبيق

هذا ADR **accepted** وقابل للتنفيذ، لكنه وثائقي فقط في هذه المهمة. لم يضف Schema أو
Migration أو API أو واجهة أو feature flag، ولم يغير التسجيل أو الاشتراك أو RBAC أو
POS أو Ledger. لا توجد خطة/تجربة/سياسة دفع جديدة، ولا بيانات demo، ولا نشر. يبدأ
التنفيذ حصريًا بالشرائح SAJ-0..6 وببواباتها المبينة أعلاه.
