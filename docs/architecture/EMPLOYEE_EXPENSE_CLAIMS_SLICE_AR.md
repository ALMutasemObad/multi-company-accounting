---
title: "Employee Expense Claims — Wave 2 P3"
status: "implemented locally; not deployed"
date: "2026-09-04"
---

# شريحة مطالبات مصروفات الموظفين

## الرحلة المنفذة

1. الموظف المرتبط بحساب الشركة ينشئ مسودة بغرض واضح وبند واحد إلى 20 بندًا.
2. كل بند يحدد التاريخ والجهة والوصف ومركز تكلفة نشطًا ومبلغًا موجبًا ومرجع
   إيصال نصيًا اختياريًا. تؤخذ عملة الشركة الأساسية تلقائيًا.
3. يحفظ الخادم لقطات الموظف ومركز التكلفة والعملة، ويجمع Decimal دون Float.
4. يرسل الموظف المسودة إلى Approval Engine؛ تتجمد الحقائق ببصمة ونسخة.
5. لا يستطيع المنشئ اعتماد طلبه. يقرر مستخدم مستقل يحمل
   `approvals.decide` القبول أو الرفض.
6. الرفض يعيد المطالبة إلى مسودة قابلة للتعديل وإعادة الإرسال. القبول يجعلها
   `READY_FOR_PAYMENT` فقط؛ لا حركة صرف ولا قيد ولا ذمة.

السلف، رفع الملفات، الضرائب، العملات غير الأساسية، إعادة تحميل المصروف على
عميل/مشروع، وإنشاء الصرف أو القيد خارج الشريحة. لم يضف العمل حقولًا تمهيدية
تضعف الحدود أو توحي بدعم غير موجود.

## API

| العملية | الصلاحية | الملاحظات |
|---|---|---|
| `GET /employee-expense-claims?scope=mine` | `employee_expenses.view` | يفرض `createdById` مع الشركة |
| `GET /employee-expense-claims?scope=company` | `employee_expenses.review` | عرض الشركة للمراجع المالي |
| `GET /employee-expense-cost-centers` | `employee_expenses.view` | إسقاط محدود للمراكز النشطة |
| `POST /employee-expense-claims` | `employee_expenses.submit` | CSRF + Idempotency-Key؛ مسودة فقط |
| `PATCH /employee-expense-claims/{claimId}` | `employee_expenses.submit` | مالك المسودة + version + Idempotency-Key |
| `POST /approval-requests` | حسب نوع الموضوع | `EMPLOYEE_EXPENSE_CLAIM` يطلب `employee_expenses.submit` |
| قرارات Approval الحالية | `approvals.decide` | Maker/Checker وبصمة ونسخة؛ العرض يتطلب `approvals.view` |

المصدر الحاكم للعقد هو `packages/contracts/openapi.yaml`، وحراس أجسام الإنشاء
والتعديل مولدة منه. `costCenterId` وDecimal نصوص في HTTP، ولا توجد خاصية ملف.

## ملكية الملفات والعقود

- سياق المصروفات: `apps/api/src/employee-expenses/*`، نموذجا المطالبة والبند،
  حالات المطالبة، قواعد Decimal، idempotency، snapshot والتدقيق.
- HR: `employee-expense-employee-adapter.ts` فقط؛ يعيد مرجع موظف محدودًا ولا
  يسمح للمصروفات بقراءة نموذج Prisma الخاص به مباشرة.
- Core Accounting: `employee-expense-cost-center-adapter.ts` فقط؛ قراءة مرجع
  مركز تكلفة محدود، بلا كتابة.
- Tenant: `employee-expense-currency-adapter.ts` فقط؛ قراءة العملة الأساسية.
- Approvals: نوع موضوع جديد وربط Adapter؛ يظل قرار الموافقة ملك Approvals
  وانتقال المطالبة ملك Employee Expenses.
- Treasury وPurchases وCore Accounting Ledger: لا ملفات خدمة ولا جداول ولا
  كتابات عُدلت لإنتاج أثر مالي.

تستخدم الشريحة استحقاق `HUMAN_RESOURCES` التجاري الحالي لتجنب إضافة Product SKU
غير معتمد، لكن ذلك لا يجعل HR مالكًا للمطالبة. RBAC مستقل بالصلاحيات الثلاث.

## التحقق المطلوب للدمج

- Prisma format/validate/generate وTypeScript API/Web/Test.
- بوابات OpenAPI وi18n وUI، واختبارات Route وApproval permission.
- اختبار MariaDB للإنشاء المتزامن بنفس المفتاح، mismatch، Maker/Checker، العزل،
  وإثبات عدم تغير عدد Payments أو AccountingDocuments بعد القبول.
- تطبيق migration على قاعدة فارغة وترقية baseline واختبار rollback على MariaDB
  10.11 وMySQL 8.4 قبل الإنتاج؛ نجاح mocks لا يغني عن هذه البوابة.
- فحص بصري بأربع لغات ضمن الحزمة العامة، ولقطتا قبول عربيتان بعرض 390 و1440 في
  `docs/evidence/employee-expenses-20260904/`.

## قرار الجاهزية المالية

الحالة الحالية جاهزة لدمج **دورة المطالبة والمراجعة** فقط. تشغيل الدفع أو
الترحيل محجوب تصميميًا حتى يعتمد عقد أوسع وفق ADR-020. لذلك لا ينبغي لأي مستهلك
اعتبار `READY_FOR_PAYMENT` دليل سداد أو قيد، ولا إنشاء تكامل polling غير موثق
حولها.
