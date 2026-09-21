# إصلاح سباق مرجع حساب العميل

## النتيجة

يفرض `CustomerService.updateCustomer` قفل الحساب وفحص أهليته داخل المعاملة كلما
حمل الطلب `receivableAccountId`، حتى إن ساوى القيمة المقروءة. لا تعتمد السلامة على
مقارنة snapshot غير مقفل؛ الطلب الذي لا يحمل الحقل وحده يتجاوز القفل.

يثبت الاختبار الحالتين، كما يثبت أن القفل يسبق `customer.update`.

لا يوجد تغيير schema أو OpenAPI أو سلوك HTTP، ولا push أو نشر.

## التحقق

- اختبار `customer-ports.test.ts`: 3/3 ناجحة.
- `@mcap/api` TypeScript typecheck: ناجح.
- `git diff --check`: ناجح.
