---
package: "csv-parse"
version: "7.0.2"
status: "accepted for isolated bank-statement prototype"
reviewed: "2026-08-26"
owner: "Treasury"
license: "MIT"
---

# اعتماد csv-parse

## القرار والغرض

اعتمد `csv-parse@7.0.2` لقراءة CSV فقط داخل Adapter كشف البنك. لا يملك قواعد المطابقة أو العملة أو اتجاه المبلغ، ولا تصل أنواعه إلى عقد المجال أو OpenAPI أو Prisma.

- المصدر: https://github.com/adaltas/node-csv/tree/master/packages/csv-parse
- حزمة npm: https://www.npmjs.com/package/csv-parse/v/7.0.2
- integrity: `sha512-uKZghv9UmPkMVLYy//KZ9HFAIJsl7wkhoEdIL0+rhuSY9pZQlhaeGEDPIe+/w7eh81MOql8Q/9+inAGWG6ZHYA==`
- الرخصة: MIT، وإشعارها محفوظ في `THIRD_PARTY_NOTICES.md`.
- الاعتماديات العابرة للحزمة: لا يوجد.

## حدود الدمج

الاستيراد مسموح فقط في `treasury/reconciliation/adapters/csv-bank-statement-adapter.ts` ويحمي ذلك اختبار معماري. يمر الناتج إلى `NormalizedBankStatement` المحلي، ويحدد Profile صراحة أسماء الأعمدة والفاصل وصيغة التاريخ والعملة واتجاه المبلغ؛ لا توجد heuristics مالية.

الحدود التشغيلية: UTF-8 صارم، 512KB للملف، 5000 حركة، 64KB للسجل، عناوين فريدة، أربعة منازل عشرية كحد أقصى، ومنع الصفر والتعارض بين debit وcredit.

## الأمن والتحديث والخروج

- أعاد `npm audit --omit=dev --omit=optional` في 2026-08-26 صفر ثغرات production.
- يراجع المالك الإصدار ونشرات الأمن ربع سنويًا وعند أي Advisory؛ لا تحدث النسخة بلا إعادة اختبارات العقد والأداء.
- بدائل التقييم: parser محلي محدود وPapa Parse. اختيرت الحزمة لصغر النطاق ودعم parsing الصارم وعدم حاجتنا إلى DOM أو خدمة خارجية.
- خطة الخروج: استبدال Adapter فقط؛ أثبت Fake في الاختبار أن المستهلك يعتمد `BankStatementParserPort` والعقد المحلي لا نوع الحزمة.
- لا يعني هذا القرار الموافقة على ميزة مطابقة إنتاجية؛ يلزم قرار مستقل للمرحلة 2.
