---
package: "fast-xml-parser"
version: "5.11.0"
status: "accepted for isolated CAMT.053 prototype"
reviewed: "2026-08-26"
owner: "Treasury"
license: "MIT"
---

# اعتماد fast-xml-parser

## القرار والغرض

اعتمد `fast-xml-parser@5.11.0` لتحليل XML في كشوف CAMT.053 فقط. استخراج الحساب والعملة والأرصدة وحالات `BOOK` والتطبيع والتحقق المالي كلها داخل Adapter محلي.

- المصدر: https://github.com/NaturalIntelligence/fast-xml-parser
- حزمة npm: https://www.npmjs.com/package/fast-xml-parser/v/5.11.0
- integrity: `sha512-9IGxMqvqLOnqP+Egi1nqDHKv5k8aZ7r9n558enxcucmyVGEBNPAU+MOg/8jPIS7rO7sSq4gFm1/nHtiaubMruw==`
- الرخصة: MIT، وإشعارها محفوظ في `THIRD_PARTY_NOTICES.md`.
- الاعتماديات العابرة المقفلة حاليًا في `package-lock.json`: `@nodable/entities@3.0.0` و`fast-xml-builder@1.3.1` و`is-unsafe@2.0.2` و`path-expression-matcher@1.6.2` و`strnum@2.4.2` و`xml-naming@0.3.0` و`anynum@1.0.1`.

## حدود الدمج والأمن

الاستيراد مسموح فقط في `treasury/reconciliation/adapters/camt053-bank-statement-adapter.ts` ويحمي ذلك اختبار معماري. يستخدم Parser مع `processEntities: false`، ويرفض `DOCTYPE` و`ENTITY` قبل التحقق والتحليل، ولا يقرأ ملفات أو شبكة ولا ينفذ parsing داخل معاملة قاعدة بيانات.

الحدود التشغيلية: UTF-8 صارم، 512KB، 5000 قيد، مستند `BkToCstmrStmt` واحد، عملة حساب واحدة، وحساب متوقع اختياري. يرفض اختلاف معادلة opening balance + booked movement = closing balance عندما لا توجد قيود متجاهلة.

## التحديث والخروج

- الإصدار أعلى من الإصدار المصحح للنشرة `GHSA-jmr7-xgp7-cmfj`، كما أن تعطيل الكيانات ورفض DTD دفاعان مستقلان.
- أعاد `npm audit --omit=dev --omit=optional` في 2026-08-26 صفر ثغرات production.
- يراجع المالك الإصدار ونشرات الأمن ربع سنويًا وعند أي Advisory، مع إعادة fixtures الخبيثة واختبار الحد الأعلى.
- بدائل التقييم: SAX parser محلي/محدود و`xml2js`. اختيرت الحزمة لصغر طبقة الربط ودعم namespaces والتحقق دون native runtime.
- خطة الخروج: استبدال CAMT Adapter فقط؛ العقد وFake لا يعتمدان أي شكل XML أو نوع من الحزمة.
- لا يعني هذا القرار الموافقة على قاعدة بيانات أو API أو واجهة للمطابقة؛ يلزم قرار مستقل للمرحلة 2.
