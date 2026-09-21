# ADM-1A — Account version CAS

## المنفذ

- أضيف `Account.version` بترحيل MySQL/MariaDB، مع rollback متعمد يحافظ على العمود.
- صارت update/deactivate/delete تتطلب `expectedVersion` وتنفذ CAS مع `companyId`.
- يعيد التعارض `409 VERSION_CONFLICT`، بينما يبقى المعرّف العابر للشركات `404`.
- يزيد reparent نسخة كل صف تغير مستواه مرة واحدة فقط وبترتيب معرّف ثابت.
- يحسب الخادم نسخة مرشح الربط في default template من القراءة نفسها ثم ينفذ CAS
  عليها؛ لا يحتاج العميل إرسالها، وإعادة التطبيق لا تزيد النسخة.
- يطبع demo seed القيم الإدارية عبر CAS على النسخة المقروءة ويزيد `version` عند
  تطبيع سجل قائم، وتزيد update arms في fixtures النسخة بدل إخفاء invariant.
- حدث OpenAPI والحارس المولد وواجهة Accounts. عند 409 لا تعيد الواجهة الأمر، بل
  تغلق snapshot التحرير القديم وتعيد تحميل البيانات.

## حدود الشريحة

لم ينشأ جدول mappings أو API أو permission أو consumer من ADM-1B. لا تسقط عملية
الرجوع عمود `Account.version`، ولا يجوز تشغيل binary قديم يكتب Account بلا CAS.

## التحقق

تسجل نتيجة الأوامر الفعلية وقيود MariaDB/MySQL في تسليم commit؛ لا يعد نجاح الفحص
الساكن بديلًا عن مصفوفة المحركين المطلوبة قبل النشر.
