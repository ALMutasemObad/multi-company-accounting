---
package: "xstate"
version: "5.32.5"
status: "accepted behind the shared workflow-state port"
reviewed: "2026-08-27"
owner: "Core Accounting"
license: "MIT"
---

# اعتماد XState

## القرار والغرض

اعتمد `xstate@5.32.5` للانتقالات الحتمية خلف منفذ مشترك صغير تستخدمه حاليًا دورة الإقفال المالي ومحرك الموافقات. تظل قائمة الجاهزية والقيود والأرصدة والصلاحيات والتخزين والتدقيق والتزامن منطقًا محليًا تملكه السياقات المعنية، ولا تشغل المكتبة Actors أو I/O أو مؤقتات أو كتابة قاعدة بيانات.

- المصدر: https://github.com/statelyai/xstate
- حزمة npm: https://www.npmjs.com/package/xstate/v/5.32.5
- integrity: `sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==`
- الرخصة: MIT، وإشعارها محفوظ في `THIRD_PARTY_NOTICES.md`.
- الاعتماديات العابرة: لا يوجد.

## حدود الدمج

الاستيراد مسموح فقط في `approvals/workflow-state-port.ts`. يكشف الملف `WorkflowStatePort` محليًا صغيرًا، وتبني فوقه Fiscal انتقالات `OPEN → PREPARING → AWAITING_APPROVAL → REVIEWED → CLOSED`، ويبني محرك الموافقات انتقالات الطلب `PENDING → APPROVED/REJECTED`. لا تعبر أنواع XState إلى الخدمات أو Router أو OpenAPI أو Prisma أو الواجهة.

تستخدم دوال الانتقال النقية فقط. لا تستخدم Actors أو persistence الخاص بالمكتبة، ولا actions جانبية، ولا guards تقرأ قاعدة البيانات. تتحقق الخدمة محليًا من الجاهزية والصلاحيات والنسخ قبل طلب الانتقال، ثم تحفظ الحالة المحلية داخل المعاملة.

## الأمن والتحديث والخروج

- أظهر سجل npm في 2026-08-27 أن الإصدار MIT وبلا اعتماديات، وأعاد فحص OSV المباشر لهذا الإصدار صفر ثغرات معروفة.
- يراجع المالك الإصدار والنشرات ربع سنويًا وعند أي Advisory؛ لا تحدث النسخة بلا إعادة اختبارات مصفوفة الانتقال والعقد.
- اختير الإصدار المستقر 5.x ولم يعتمد خط 6.x التجريبي.
- خطة الخروج: يستبدل تنفيذ `WorkflowStatePort` بجدول انتقال محلي؛ تختبر المصفوفات نفسها ولا يعتمد أي مستهلك على Snapshot أو Actor من XState.
