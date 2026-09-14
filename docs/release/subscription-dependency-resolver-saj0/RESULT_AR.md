# نتيجة SAJ-0 — محلل اعتماديات وحدات الاشتراك

## النتيجة

مركزت المهمة حلّ اعتماديات وحدات المنصة في دالة نقية واحدة:
`resolveModuleDependencies`. تستخدمها سياسة بدء الشركة، وخدمة دورة حياة
الاشتراك، ومحوّل قراءة استحقاقات الشركة، مع إبقاء قرارات التسعير والكتابة
وقراءة Prisma خارج المحلل.

يشمل الحل ترتيبًا حتميًا dependency-first، وكشف الدورات، والاعتماديات المفقودة
أو غير النشطة، والأكواد غير المعروفة، والوحدات المكررة، مع وضع صارم للكتّاب
ووضع إسقاط آمن للقرّاء. لا يوجد تغيير في Schema أو OpenAPI أو عقد خارجي.

## الملفات

- `apps/api/src/platform-subscriptions/platform-module-dependency-resolver.ts`
- `apps/api/src/platform-subscriptions/new-company-start-policy.ts`
- `apps/api/src/platform-subscriptions/platform-subscription-service.ts`
- `apps/api/src/platform-subscriptions/prisma-company-entitlement-query-adapter.ts`
- `apps/api/tests/platform-module-dependency-resolver.test.ts`

## التحقق

- أُضيفت اختبارات للسلسلة والـdiamond والدورات والاعتماديات المفقودة وغير
  النشطة، الأكواد غير المعروفة، المكررات، الإسقاط الآمن، ثبات الترتيب مع
  إدخال مبعثر، وتمرير قيم Decimal دون إعادة تفسير.
- نجح `git diff --check`.
- لم تُشغّل اختبارات Vitest أو typecheck لغياب `node_modules` في المهمة؛ لم تُثبت
  أي اعتماديات وفق نطاق SAJ-0.

لا push أو PR أو merge أو deploy ضمن هذه المهمة.
