---
title: "سداد اعتماد سياق استيراد البيانات"
status: "implemented"
date: "2026-08-29"
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "DATA_IMPORT_CONTEXT_AR.md"
---

# سداد اعتماد سياق استيراد البيانات

## المشكلة

كان `DataImportService` يستورد مباشرة `SupplierService` و`SalesInvoiceService` و
`PurchaseInvoiceService` وأنواع أوامرها وأخطائها. وفي الاتجاه المعاكس كانت خدمتا
الفواتير تستوردان `DataImportInvoiceGroup`. كذلك كان Data Import يستدعي مُصدّر CSV/XLSX
من سياق Reports رغم أن الوظيفة بنية ملفات عامة. هذا خالف خريطة السياقات التي تصف Data
Import كـProcess Manager يعتمد على منافذ المالكين.

## التنفيذ

- أضيفت عقود المالكين `supplier-ports.ts` و`sales-invoice-ports.ts` و
  `purchase-invoice-ports.ts`، وتنفذها الخدمات الخرسانية مع الحفاظ على نفس المعاملة
  والترتيب الثابت لأوامر الفواتير.
- أصبح Data Import يعتمد على المنافذ الأربعة فقط، ولم يعد يعرف الخدمات الخرسانية أو
  يستورد نوعًا من ملفات تنفيذها.
- أصبحت مجموعة صفوف الفاتورة عقدًا هيكليًا يملكه كل سياق، فانقطع الاعتماد العكسي من
  Sales/Purchases إلى Imports.
- استُخرج إنشاء CSV/XLSX الجدولي إلى `platform/tabular-file-exporter.ts` وتعيد واجهة
  التقارير تصدير الدالتين للمحافظة على التوافق.
- أضيف اختبار يبني رسم الاعتماد الفعلي لكل ملفات TypeScript في API ويفشل عند ظهور أي
  دورة، مع فحص صريح لحد Data Import.

## معايير الخروج

- لا يستورد `imports/data-import-service.ts` أي `*-service.ts` من المالكين ولا Reports.
- لا تستورد خدمات Sales/Purchases/Suppliers شيئًا من مجلد Imports.
- رسم اعتماد ملفات API بلا دورات.
- فحص TypeScript واختبارات الاستيراد والتقارير والحواجز المعمارية ناجحة.
- بوابتا MariaDB وMySQL ناجحتان قبل الدمج والنشر.

## مانع أمني ظهر أثناء بوابة الإصدار

كشفت بوابة `npm audit --omit=dev --omit=optional --audit-level=high` بعد نجاح اختبارات
قواعد البيانات أن `@prisma/adapter-mariadb@7.9.1` يثبت `mariadb@3.4.5` المتأثر
بـ`GHSA-cqhc-2h57-wpxf` و`GHSA-42r5-vhpq-m858`. أضيف override مركزي إلى
`mariadb@3.5.3`، وهو خارج النطاق المتأثر ويدعم Node 20 فأعلى، وجُدد ملف القفل من
`npm@12.0.2`. أثبت التثبيت النظيف استخدام 3.5.3 وعودة تدقيق الإنتاج إلى صفر ثغرات.

يبقى override مقصودًا إلى أن يرفع Prisma تثبيته الداخلي؛ عند ترقية Prisma يجب التحقق
من شجرة الاعتماد ثم حذف override إن أصبح زائدًا، لا إبقاؤه بصورة دائمة بلا مراجعة.
