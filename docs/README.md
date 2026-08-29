# فهرس توثيق النظام

## ابدأ من هنا

- [حالة النظام الحالية والخطوات التالية](CURRENT_STATE_AND_NEXT_STEPS_AR.md): مرجع
  التسليم للمحادثة أو المرحلة التالية، ويبين المنفذ والمخطط والفجوات وحالة النشر.
- [README الرئيسي](../README.md): القدرات والتشغيل المحلي وبوابات التحقق.
- [حالة التنفيذ](implementation-status.md): سجل زمني تفصيلي للمراحل؛ الأرقام داخل مرحلة
  قديمة تخص وقتها ولا تستبدل لقطة الحالة الحالية.
- [فهرس الحوكمة المعمارية](architecture/README.md): ADR والسياسات وحدود الملكية.

## المنتج وتجربة الاستخدام

- [خارطة اللغات والتسجيل وتجربة الاستخدام](product-roadmap.md).
- [دليل تعدد اللغات](localization.md).
- [سياسة محتوى الواجهة والتجاوب](UI_CONTENT_RESPONSIVE_POLICY_AR.md).
- [الفحص البصري](visual-qa.md).

## التشغيل والإنتاج

- [دليل التشغيل الإنتاجي](production-operations.md).
- [النشر على iFastNet/cPanel](ifastnet-cpanel-deployment.md).
- [التعافي من الكوارث](production-disaster-recovery.md).
- [المهلات والقياسات والتنبيهات](operational-resilience.md).
- [سياسة تنبيهات الاعتماديات](security-advisories.md).

## تدقيقات مؤرخة

الملفات التالية أدلة للحالة وقت تنفيذها، وليست إثباتًا أن الالتزام المحلي الحالي منشور:

- [سجل أعمال التدقيق والتقوية الهندسية — 28 أغسطس 2026](ENGINEERING_HARDENING_WORKLOG_2026-08-28_AR.md).
- [تدقيق DDD وEvent-Driven](ARCHITECTURE_AUDIT_DDD_EVENT_DRIVEN_AR.md).
- [تدقيق بيئة الإنتاج](PRODUCTION_ENVIRONMENT_AUDIT_AR.md).
- [تدقيق الاستخدام وتجربة المستخدم في الإنتاج](PRODUCTION_END_TO_END_UX_AUDIT_AR.md).

## قاعدة التحديث

عند إغلاق مرحلة يجب تحديث:

1. [الحالة الحالية](CURRENT_STATE_AND_NEXT_STEPS_AR.md).
2. [حالة التنفيذ](implementation-status.md).
3. `README.md` إذا تغير التشغيل أو الوحدات أو التحقق.
4. خريطة السياقات وADR والسياسات المتأثرة.
5. حالة النشر والفجوات بعبارات صريحة: منفذ محليًا، منشور، أو مخطط فقط.
