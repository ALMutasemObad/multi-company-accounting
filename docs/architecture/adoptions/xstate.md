---
package: "xstate"
version: "5.32.5"
status: "accepted for isolated financial-close transitions"
reviewed: "2026-08-27"
owner: "Core Accounting"
license: "MIT"
---

# اعتماد XState

## القرار والغرض

اعتمد `xstate@5.32.5` للانتقالات الحتمية في دورة الإقفال المالي فقط. تظل قائمة الجاهزية والقيود والأرصدة والصلاحيات والتخزين والتدقيق والتزامن منطقًا محليًا يملكه `Core Accounting`، ولا تشغل المكتبة Actors أو I/O أو مؤقتات أو كتابة قاعدة بيانات.

- المصدر: https://github.com/statelyai/xstate
- حزمة npm: https://www.npmjs.com/package/xstate/v/5.32.5
- integrity: `sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==`
- الرخصة: MIT، وإشعارها محفوظ في `THIRD_PARTY_NOTICES.md`.
- الاعتماديات العابرة: لا يوجد.

## حدود الدمج

الاستيراد مسموح فقط في `fiscal/financial-close-workflow.ts`. يكشف الملف عقدًا محليًا صغيرًا يحول الحالات `OPEN → PREPARING → REVIEWED → CLOSED` ويعيد الرفض من `REVIEWED` إلى `PREPARING`. لا تعبر أنواع XState إلى Router أو OpenAPI أو Prisma أو الواجهة.

تستخدم دوال الانتقال النقية فقط. لا تستخدم Actors أو persistence الخاص بالمكتبة، ولا actions جانبية، ولا guards تقرأ قاعدة البيانات. تتحقق الخدمة محليًا من الجاهزية والصلاحيات والنسخ قبل طلب الانتقال، ثم تحفظ الحالة المحلية داخل المعاملة.

## الأمن والتحديث والخروج

- أظهر سجل npm في 2026-08-27 أن الإصدار MIT وبلا اعتماديات، وأعاد فحص OSV المباشر لهذا الإصدار صفر ثغرات معروفة.
- يراجع المالك الإصدار والنشرات ربع سنويًا وعند أي Advisory؛ لا تحدث النسخة بلا إعادة اختبارات مصفوفة الانتقال والعقد.
- اختير الإصدار المستقر 5.x ولم يعتمد خط 6.x التجريبي.
- خطة الخروج: يستبدل Adapter الانتقال بجدول انتقال محلي؛ تختبر المصفوفة نفسها ولا يعتمد أي مستهلك على Snapshot أو Actor من XState.
