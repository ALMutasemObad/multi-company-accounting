---
package: "deepmerge-ts"
version: "8.0.1"
status: "security override for Prisma CLI transitive dependency"
reviewed: "2026-08-28"
owner: "Platform Engineering"
license: "BSD-3-Clause"
---

# تجاوز أمني لاعتماد deepmerge-ts العابر في Prisma

## السبب والنطاق

يثبت `prisma@7.9.1` عبر `@prisma/config@7.9.1` الإصدار
`deepmerge-ts@7.1.5` المتأثر بـ`GHSA-ggr8-5vv4-36mx` و`CVE-2026-40345`.
تسمح الثغرة باستنزاف المكدس عند دمج رسم كائنات دائري مصمم لذلك، والإصلاح منشور
منذ `8.0.0`.

المسار الحالي تطويري فقط: تستخدمه أداة Prisma لدمج إعداد
`prisma.config.ts` الذي يملكه المطور، ولا يدخل في عملية API أو يستقبل جسم طلب
من المستخدم. لذلك لا يوجد مسار استغلال شبكي مثبت في التطبيق، لكن يبقى الاعتماد
المصاب مرفوضًا في بوابة سلسلة التوريد.

## القرار

- يفرض `package.json.overrides` الإصدار المثبت `8.0.1` بدل خفض Prisma قسريًا
  إلى إصدار رئيسي أقدم كما يقترح `npm audit fix --force`.
- المصدر: https://github.com/RebeccaStevens/deepmerge-ts
- الإصدار: https://www.npmjs.com/package/deepmerge-ts/v/8.0.1
- النشرة: https://github.com/advisories/GHSA-ggr8-5vv4-36mx
- رخصة `BSD-3-Clause` محفوظة في `THIRD_PARTY_NOTICES.md`.
- integrity:
  `sha512-szCXE7YLCvLKR9bFPJcvsezOShdalctSvrgN/LM/QGUEPZQajwjmsMObZ6/DuANT5lxzM/wtO8Feubwdkz8myA==`.

## التوافق والتحقق والخروج

`@prisma/config` يستخدم تصدير `deepmerge` العادي بوصفه merger لـ`c12`.
يعاد بعد التجاوز تشغيل `prisma generate` و`prisma validate` و
`prisma migrate status` وحزمة الاختبارات والبناء؛ لا يقبل التجاوز إن أخفق أي
منها.

يراجع التجاوز عند كل تحديث Prisma. يحذف فقط عندما يعتمد
`@prisma/config` إصدارًا مصححًا `deepmerge-ts >= 8.0.0`، ثم يعاد توليد
ملف القفل وتشغيل بوابات Prisma و`npm audit`.
