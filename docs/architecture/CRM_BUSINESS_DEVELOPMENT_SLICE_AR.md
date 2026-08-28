---
title: "CRM and Business Development First Vertical Slice"
status: "planned; not implemented"
version: "1.0"
date: "2026-08-28"
related:
  - "ADR-014-crm-business-development-priority.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "MASTER_DATA_CODE_POLICY_AR.md"
  - "CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md"
  - "OPENAPI_EXECUTABLE_CONTRACTS_AR.md"
  - "CHANGE_REVIEW_CHECKLIST_AR.md"
---

# خطة أول شريحة رأسية لـCRM وتطوير الأعمال

## 1. نتيجة الإغلاق

يستطيع فريق تطوير الأعمال:

1. إنشاء Lead ومتابعته وتأهيله أو استبعاده.
2. تحويل Lead مؤهل إلى Opportunity، أو إنشاء Opportunity لعميل Sales موجود.
3. تحريك الفرصة عبر Pipeline، وتسجيل المكالمات والاجتماعات والمهام والملاحظات.
4. تحويل Lead إلى Customer واحد عبر منفذ Sales ثم إعلان الفرصة فائزة أو خاسرة.
5. رؤية Pipeline مجمعة حسب المرحلة والعملة من دون جمع عملات مختلفة.

لا تنشئ الشريحة فاتورة أو تحصيلًا أو مشروعًا أو قيدًا. ولا تسجل أطراف قضية قانونية.

## 2. النطاق

### داخل النطاق

- Leads يدوية ومصادر `MANUAL / REFERRAL / WEBSITE / OTHER`.
- Opportunity Pipeline ثابت أوليًا.
- قيمة متوقعة اختيارية وعملة واحتمال بالنقاط الأساسية.
- نشاط يدوي `CALL / MEETING / TASK / NOTE` وحالة إكمال.
- تحويل إلى Customer موجود أو جديد عبر Sales Port.
- بحث ومرشحات حسب الحالة والمالك والمرحلة والتاريخ والعملة.
- ملخص Pipeline مشتق لحظيًا ومجمع لكل عملة.
- Audit لكل أمر تغيير.

### خارج النطاق

- البريد والتقويم وWhatsApp والاتصالات المسجلة والتكاملات الخارجية.
- حملات التسويق، النماذج العامة، إثراء البيانات، الاستيراد الجماعي، والتخصيص الحر للمراحل.
- عروض الأسعار والعقود والفواتير والتحصيل وحد الائتمان.
- إنشاء مشروع/قضية أو فحص تعارض أو أطراف خصومة أو مستندات.
- عمولة المبيعات وتوقع الإيراد المحاسبي أو تحويل القيمة المتوقعة إلى Ledger.
- حذف صلب أو مزامنة ثنائية مع Customer.

## 3. نموذج البيانات

### `CrmLead`

| الحقل | القرار |
|---|---|
| `id/publicId/companyId` | معرف داخلي وUUID عام وعزل الشركة |
| `code` | `LED-000001` يولده الخادم وثابت داخل الشركة |
| `kind` | `INDIVIDUAL / ORGANIZATION` |
| `displayName` | الاسم التجاري أو الشخصي قبل التحويل، حتى 200 |
| `contactName` | اختياري للمنظمة، حتى 160 |
| `phone/email` | اختياريان؛ لا يعادان في قوائم لا تحتاجهما |
| `source/sourceDetails` | Enum وملاحظة قصيرة اختيارية |
| `status` | `NEW / CONTACTED / QUALIFIED / DISQUALIFIED / CONVERTED` |
| `ownerEmployeeId` | موظف HR نشط مرتبط بحساب شركة نشط؛ لا اسم مكرر |
| `summary` | وصف تجاري مختصر حتى 1000؛ يمنع المحتوى القانوني السري |
| `convertedCustomerId/convertedAt` | مرجع Sales ووقت التحويل، بلا نسخة من Customer |
| `disqualificationReason` | إلزامي عند الاستبعاد |
| `version/createdById/updatedById/timestamps` | تزامن وتدقيق |

### `CrmOpportunity`

| الحقل | القرار |
|---|---|
| `id/publicId/companyId` | هوية وعزل |
| `code` | `OPP-000001` يولده الخادم وثابت |
| `leadId/customerId` | أحدهما على الأقل؛ Customer مرجع مملوك لـSales |
| `title` | وصف تجاري مختصر |
| `stage` | `DISCOVERY / PROPOSAL / NEGOTIATION / WON / LOST` |
| `ownerEmployeeId` | موظف HR نشط مرتبط بحساب شركة نشط |
| `expectedCloseDate` | تاريخ متوقع اختياري |
| `estimatedAmount/currencyId` | كلاهما موجود أو غائب؛ Decimal نصي في API |
| `probabilityBps` | عدد صحيح 0–10000؛ لا Float |
| `lostReason/wonAt/lostAt` | قيود حالة وتاريخ |
| `version/createdById/updatedById/timestamps` | تزامن وتدقيق |

القيمة الموزونة `estimatedAmount × probabilityBps / 10000` مشتقة ولا تخزن. لا تجمع
الواجهة عملتين في رقم واحد، ولا تحولها بأسعار صرف أو تعرضها كتوقع محاسبي.

### `CrmActivity`

| الحقل | القرار |
|---|---|
| `id/publicId/companyId` | هوية وعزل |
| `leadId/opportunityId` | واحد فقط، بعلاقة مركبة مع الشركة |
| `type` | `CALL / MEETING / TASK / NOTE` |
| `subject/details` | عنوان ومحتوى محدود؛ لا ملفات ولا HTML |
| `assignedEmployeeId` | موظف HR نشط مرتبط بحساب شركة نشط |
| `scheduledFor` | اختياري، UTC في التخزين |
| `status` | `OPEN / COMPLETED / CANCELLED` |
| `completedAt/cancelledAt` | متسقان مع الحالة |
| `version/createdById/updatedById/timestamps` | تزامن وتدقيق |

كل FK أعمال عابر للسياق يمر تحققه عبر Port، وتحمل العلاقات الداخلية `companyId`
ومفاتيح مركبة. لا يوجد Cascade Delete.

## 4. حالات الاستخدام والانتقالات

### Lead

- إنشاء وتعديل `NEW/CONTACTED`.
- `mark-contacted` ينقل NEW إلى CONTACTED.
- `qualify` ينقل إلى QUALIFIED وينشئ Opportunity واحدة في المعاملة نفسها.
- `disqualify` يتطلب سببًا؛ لا حذف.
- `convert` يقبل أحد مسارين:
  - `existingCustomerId` يتحقق منه Sales Query Port.
  - بيانات إنشاء مختصرة مع `receivableAccountId` تستدعي Sales Provisioning Port.
- التحويل من QUALIFIED فقط، ويربط الفرص التابعة بالعميل داخل المعاملة.
- التحويل نهائي في CRM؛ التصحيح لا يحذف Customer.

### Opportunity

- إنشاء مباشرة لعميل موجود أو من `qualify`.
- الانتقال بين مراحل مفتوحة مع `version` وIdempotency.
- `win` يتطلب Customer مرتبطًا.
- `lose` يتطلب سببًا.
- WON/LOST نهائيتان في المسار العادي.
- `reopen` أمر إداري مسبب ومدقق يعيد المرحلة السابقة المفتوحة ولا يعكس أي أثر مالي،
  لأن CRM لم ينشئ أثرًا ماليًا أصلًا.

### Activity

- إنشاء وتعديل نشاط مفتوح.
- الإكمال أو الإلغاء مسببان ومحميان بالنسخة.
- لا حذف صلب؛ التصحيح عبر الإلغاء ونشاط جديد.
- الاستحقاق يعرض بالاستعلام فقط في الشريحة الأولى؛ لا Outbox بلا مستهلك تنبيه متعاقد.

## 5. المنافذ والحدود

### منافذ يستهلكها CRM

- `CrmWorkforceQueryPort` من Human Resources:
  التحقق من موظف نشط داخل الشركة وله حساب شركة نشط، وإرجاع اسمه الوظيفي المرجعي.
  يستخدم HR حدوده القائمة مع Identity ولا يقرأ CRM جدول User أو UserCompany مباشرة.
- `CrmCustomerQueryPort` من Sales:
  البحث عن Customer نشط داخل الشركة والتحقق من المرجع.
- `CrmCustomerProvisioningPort` من Sales:
  إنشاء Customer وفق قواعد Sales ورمز `CUS-` وحساب الذمة داخل `TransactionClient`
  نفسه، ثم إعادة `customerId` فقط.
- `CrmCurrencyQueryPort` من Tenant:
  التحقق من عملة مفعلة للشركة عند وجود مبلغ متوقع.
- `AuditAppendPort`:
  تسجيل الأمر والفاعل والمعرفات والحالة من دون وضع الهاتف أو البريد أو التفاصيل في
  `metadata`.

### ما يمنع

- لا استيراد لـ`CustomerService` من CRM؛ يستهلك السياق فقط `CrmCustomerQueryPort`
  و`CrmCustomerProvisioningPort` المملوكين لـSales في `sales/customer-ports.ts`.
- لا وصول إلى `SalesInvoice/ReceivableItem/Receipt/InventoryMovement/JournalEntry`.
- لا استدعاء `PostingEngine`.
- لا استدعاء Professional Projects في الشريحة الأولى.
- لا شبكة أو بريد داخل المعاملة.

## 6. الصلاحيات والخصوصية

| الصلاحية | الغرض |
|---|---|
| `crm.view` | القوائم والتفاصيل والـPipeline |
| `crm.manage` | إنشاء وتعديل وتأهيل واستبعاد وفرص ومراحل |
| `crm.activities.manage` | إنشاء وإكمال وإلغاء المتابعات |
| `crm.convert` | ربط/إنشاء Customer وإعادة فتح حالة نهائية |

- يضاف العرض والإدارة والأنشطة والتحويل إلى Administrator في Seed.
- لا تمنح صلاحيات Customer أو Sales Invoice صلاحية CRM ضمنيًا، والعكس صحيح.
- الشريحة الأولى RBAC على مستوى الشركة؛ ليست مخزنًا لبيانات قانونية سرية.
- البحث والمجاميع لا يعيدان الهاتف أو البريد أو `details`.
- استجابة التحويل تعيد مرجع Customer المختصر فقط.

## 7. OpenAPI

المسارات المخططة:

- `GET/POST /crm/leads`
- `GET/PATCH /crm/leads/{leadId}`
- `POST /crm/leads/{leadId}/mark-contacted`
- `POST /crm/leads/{leadId}/qualify`
- `POST /crm/leads/{leadId}/disqualify`
- `POST /crm/leads/{leadId}/convert`
- `GET/POST /crm/opportunities`
- `GET/PATCH /crm/opportunities/{opportunityId}`
- `POST /crm/opportunities/{opportunityId}/stage`
- `POST /crm/opportunities/{opportunityId}/win`
- `POST /crm/opportunities/{opportunityId}/lose`
- `POST /crm/opportunities/{opportunityId}/reopen`
- `GET /crm/pipeline`
- `GET/POST /crm/activities`
- `PATCH /crm/activities/{activityId}`
- `POST /crm/activities/{activityId}/complete`
- `POST /crm/activities/{activityId}/cancel`

القواعد:

- كل معرف BigInt في JSON نص عشري، وكل Decimal نص وفق العقد التنفيذي.
- كل أمر إنشاء/انتقال يقبل `Idempotency-Key`.
- كل تعديل أو انتقال يحمل `version`.
- أخطاء `404/409/422` موحدة ولا تكشف وجود سجل في شركة أخرى.
- Pagination ومرشحات bounded، واستجابات Pipeline مجموعة حسب `currencyId`.

## 8. الواجهة والترجمات

- بطاقة CRM ضمن مجموعة المبيعات/العملاء في `#home`، مشروطة بـ`crm.view`.
- صفحة `#crm` بثلاث مساحات:
  - Pipeline Board متجاوبة؛ تتحول إلى قائمة/مرشح على الهاتف بدل تمرير الصفحة.
  - Leads مع حالات وتأهيل وتحويل.
  - Activities مستحقة وقادمة ومكتملة.
- Drawer أو صفحة تفاصيل تجمع الملخص والفرصة والأنشطة من دون تكرار بيانات Customer.
- العربية والإنجليزية والهندية والأردية، مع RTL/LTR.
- اختبارات 390 و768 و1440 و1920، وأهداف لمس وتسميات وصول ولوحة مفاتيح.
- النصوص تميز بوضوح بين `قيمة متوقعة` و`إيراد/فاتورة`.
- لا يظهر زر إنشاء مشروع أو قضية في هذه الشريحة.

## 9. العزل والتزامن

- كل استعلام يبدأ بـ`companyId` من السياق الموثق، لا من الطلب.
- كل علاقة Lead/Opportunity/Activity/Employee/Customer/Currency تتحقق من الشركة نفسها.
- مالك Lead/Opportunity ومسند Activity هو Employee؛ يبقى User الحالي Actor التدقيق فقط،
  ولا تكرر جداول CRM اسم الموظف أو بريده.
- التحويل يقفل Lead أولًا، يفحص `version` والحالة، ثم يستدعي Sales Port في المعاملة
  نفسها؛ سباقان لا ينشئان عميلين.
- التأهيل يقفل Lead ثم ينشئ Opportunity ويرفع النسخة ذريًا.
- انتقال الفرصة وإكمال النشاط Update شرطي بالحالة والنسخة.
- تعاد محاولة deadlock المحددة فقط عند غلاف المعاملة، ولا يعاد `VERSION_CONFLICT`.
- لا أقفال أثناء Network I/O، ولا استعلام غير محدود داخل المعاملة.
- رمزا `LED-` و`OPP-` يحجزان عبر `MasterDataCodeSequence` داخل معاملة الإنشاء.

## 10. الاختبارات

### Domain/API

- كل انتقال صحيح وغير صحيح، والأسباب المطلوبة، والحقول المتناسقة.
- Lead مؤهل يتحول إلى Opportunity مرة واحدة.
- التحويل إلى Customer جديد أو موجود، وإعادة Idempotency والمخالفة.
- السباق على التحويل/التأهيل/المرحلة/النشاط ينجح مرة واحدة.
- مبلغ Decimal واحتمال BPS وتجميع Pipeline لكل عملة بلا جمع عابر للعملات.
- فوز بلا Customer مرفوض، ولا ينشأ Project أو Invoice أو Receipt أو Ledger.
- عزل شركتين في القائمة والبحث والتفاصيل والمجاميع والمراجع.
- رفض موظف معطل أو من شركة أخرى أو بلا حساب شركة نشط كمالك أو مسند.
- حراسة الصلاحيات وCSRF وOpenAPI request/response/route parity.

### Architecture

- CRM لا يستورد `PostingEngine` أو Prisma Models المالية أو خدمة Customer الحالية.
- Adapter Sales هو الكاتب الوحيد للعميل في رحلة التحويل.
- لا Outbox Event في الشريحة الأولى.

### UI/E2E

- إنشاء Lead وتأهيله وتحويله وتحريك Opportunity وتسجيل نشاط.
- منع الأزرار حسب الصلاحية ورسائل التعارض وإعادة التحميل.
- الترجمات الأربع وتكافؤ المفاتيح وعدم وجود نص مرئي صلب.
- RTL/LTR والمصفوفة المتجاوبة وعدم تمرير الصفحة أفقيًا.

## 11. الترحيل والعكس والإطلاق

- Migration توسعي ينشئ Enums والجداول والفهارس والعلاقات والصلاحيات فقط؛ لا Backfill.
- `CRM_ENABLED=false` افتراضيًا حتى نجاح Seed والعقود والاختبارات، ثم تفعيل محلي/مرحلي.
- `rollback.sql` يحذف الجداول والـEnums والصلاحيات فقط إذا كانت جداول CRM فارغة ولا
  توجد سجلات Idempotency مرتبطة بمساراته.
- بعد أول استخدام يمنع العكس المدمر. الرجوع التشغيلي يعطل `CRM_ENABLED` ويبقي الجداول
  والتاريخ، ثم يستخدم Forward migration أو Binary متوافق.
- لا يحذف رجوع CRM أي Customer أنشأه Sales. التحويل حقيقة تاريخية لا يعكسها CRM؛ يمكن
  تعطيل العميل من Sales إذا سمحت قواعده وبأمر مستقل.
- لا Push ولا نشر قبل طلب صريح وبوابات MariaDB 10.11 وMySQL 8.4 والإصدار الكاملة.

## 12. بوابة F2 اللاحقة

بعد إغلاق هذه الشريحة تكون المرحلة التالية `Professional Legal Intake / Conflict Check
F2`. يمنع حتى اكتمالها:

- إضافة `create-project` أو `create-matter` إلى CRM.
- تخزين أطراف الخصومة أو aliases داخل CRM.
- نسخ Notes/Activities إلى وصف القضية.
- اعتبار الفوز موافقة على فتح قضية قانونية.
