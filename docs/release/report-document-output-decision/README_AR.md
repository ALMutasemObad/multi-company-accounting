---
title: "تسليم قرار منصة مخرجات التقارير والمستندات"
status: "ready-for-local-review"
date: "2026-09-15"
task: "report-document-output-decision"
---

# تسليم قرار منصة مخرجات التقارير والمستندات

## ما نُفذ

أضيف [ADR-028](../../architecture/ADR-028-report-document-output-platform.md) بحالة
`accepted`. يميز القرار بين المستند النظامي الخارجي، المستند التشغيلي، الدليل
المحاسبي الداخلي، والتقرير query-time، ويثبت أن مالك المجال أو Reporting يملك
الـprojection بينما تشترك الصيغ في rendering kernel تقنية فقط.

حسم القرار:

- snapshot وSHA-256 وartifact hash ونسخ profile ودورة `PREPARED/ISSUED` وretention
  policy/legal hold للمستند الصادر.
- معلمات التقرير canonical، ومعاني `asOf/generatedAt/sourceWatermark`، وسياسة أن
  export مؤقت وليس archive دائمًا أو دليلًا محاسبيًا تلقائيًا.
- حدود PDF/CSV/XLSX/thermal، ومنع `Number` للأموال وformula injection والتقارير
  العريضة على الطابعة الحرارية.
- bulk export jobs بقراءة keyset وstreaming ودفعات/معاملات قصيرة، وlease وretry
  وcancellation وإعادة تفويض التنزيل.
- كاش مشتق private ومقيد بالشركة والبصمة ونسخ projection/profile/policy والصلاحية؛
  مع بقاء `/api/v1` وHTTP المشترك `no-store`، واعتبار الأرشيف النظامي غير قابل للكاش.
- فصل الصلاحيات والجمهور والتنقيح، وفشل ضريبي مغلق عند بيانات ناقصة أو مقنعة، وQA
  دلالي وبصري وقابلية وصول ورصد منخفض الكاردينالية.
- أثر الباركود والهاتف والطابعات الفعلية، من دون نقل ملكية الهوية من Inventory أو
  خلط QR الضريبي بباركود الصنف.

## عدم التداخل مع التنفيذ الضريبي

هذه المهمة عدلت ADR وتقرير التسليم فقط. نص القرار يمنع بدء أي شريحة تلمس
`apps/api/src/printing/**` أو اختبارات/fixtures الطباعة حتى تنتهي مهمة
`tax-document-presentation-implementation` وتراجع وتدمج في baseline جديدة.

أول شريحة قابلة للتنفيذ بالتوازي، RDO-1، محصورة في kernel جديدة ومصدري تقارير
`financial-statement-exporter.ts` و`tabular-file-exporter.ts` واختباراتهما. أما RDO-4
فتبدأ لاحقًا من نتيجة التنفيذ الضريبي ولا تعيد بناء A4 أو QR TLV أو amount-in-words.

## ما اختُبر

- قراءة تعليمات مساحة العمل والضوابط المعمارية الإلزامية.
- مراجعة `apps/api/src/printing` و`apps/api/src/reports` ومخطط
  `DocumentPrintArchive` واختبارات/وثائق التقارير والطباعة ذات الصلة.
- مراجعة قرارات القراءة والكاش والمعالجة الخلفية والعزل والرصد السابقة بوصفها مدخلات
  مراجعة، مع إبقاء `origin/main` مصدر الكود المقبول.
- فحص الروابط النسبية والنطاق و`git diff --check` قبل الالتزام.

لم تثبت اعتماديات ولم تشغل اختبارات تطبيق أو قاعدة بيانات؛ التغيير توثيقي فقط.

## ما لم يُنفذ وما بقي

لم ينفذ Schema أو Migration أو OpenAPI أو permission أو renderer أو report job أو
cache أو object storage أو thermal adapter، ولم يثبت امتثال ضريبي أو PDF/A/PDF/UA أو
دعم جهاز. التنفيذ المتبقي مقسم في ADR إلى RDO-1..RDO-5 مع ملفات وقبول ورجوع، ويحتاج
كل جزء مهمة مستقلة مبنية على `origin/main` المتحقق منه.

لا push أو PR أو merge أو نشر في هذا التسليم.
