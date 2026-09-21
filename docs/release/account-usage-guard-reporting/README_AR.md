# ADM-1B1 — Account Usage Guard وReporting

## النتيجة

- أضيف عقد Usage مملوك لـCore Accounting يعيد فقط
  `category/count/hasImmutableHistory` ضمن فئات مغلقة، بلا DTO أو معرفات مستندات.
- أضيف `AccountUsageGuard` بترتيب مالكين ثابت، وفحص completeness، وفشل مغلق عند
  الغياب أو التكرار أو نتيجة غير كاملة أو خطأ محول.
- أضيف محول Reporting لعد `CashFlowAccountMapping` المقيد بـ`companyId + accountId`
  باستخدام `TransactionClient` الممرر فقط، ومن دون اعتماد عكسي من Accounts إلى
  Reporting.
- أضيف Account reference lock/eligibility port ومحول Prisma يقفل صف `Account`
  بـ`FOR UPDATE` ثم يتحقق من same-company وactive وallowsPosting وleaf.
- حُقن handshake في `CashFlowService.updateMapping` قبل أي قراءة أو كتابة mapping،
  مع بقاء أكواد API الحالية كما هي.
- سجل `server.ts` محول Reporting وحالة completeness، وحقن handshake في Cash Flow.
  بقي `AccountService` بلا Usage Guard عمدًا حتى تكتمل محولات المالكين السبعة.
- وُسع حارس الحدود بعقد Account lifecycle دقيق واعتماد Reporting type-only ومنع
  `accounts/** -> reports/**`.

لا يوجد تغيير schema أو migration أو OpenAPI، ولا تغيير في سلوك بقية Account
lifecycle. الالتزام النهائي هو الالتزام الحامل لهذا التقرير على فرع
`task/account-usage-guard-reporting`.

## التحقق المحلي

- اختبارات ADM-1B1 المركزة: 18/18 ناجحة.
- حزمة API كاملة بلا قاعدة بيانات: 1372 ناجحًا و199 متجاوزًا وفق بوابات البيئة.
- اختبارات حارس الحدود: 45/45 ناجحة.
- فحص المستودع الحقيقي: 341 ملفًا، 1482 import، صفر مخالفة أو تحذير مراجعة.
- Typecheck للـAPI، بما فيه اختبارات TypeScript: ناجح.
- Build للـAPI: ناجح.
- OpenAPI generated-contract check: ناجح، 187 request bodies و2423 response bodies.
- Architecture debt ratchet: ناجح وبقي baseline كما هو.

## القيود والمتبقي

- لم يُفعّل Usage Guard في update/deactivate/delete؛ المحولات المتبقية:
  Core Accounting وSales وPurchases وTax وTreasury وInventory. أي تفعيل جزئي ممنوع.
- لم تُشغّل اختبارات MariaDB/MySQL الفعلية لعدم توفر `DATABASE_URL` لقاعدة اختبار؛
  يلزم لاحقًا اختبار سباق Cash Flow mapping مقابل Account deactivate على المحركين.
- لا push أو PR أو merge أو deploy.
