---
title: "تركيب خدمات المستندات المالية عبر Ports"
status: "implemented"
date: "2026-08-29"
related:
  - "ARCHITECTURE_GUARDRAILS_AR.md"
  - "BOUNDED_CONTEXT_MAP_AR.md"
  - "AR_AP_SETTLEMENT_ITEMS_AR.md"
  - "TAX_CONTEXT_OWNERSHIP_AR.md"
  - "TREASURY_CONTEXT_OWNERSHIP_AR.md"
---

# تركيب خدمات المستندات المالية عبر Ports

## القرار

تعتمد خدمات فواتير المبيعات والمشتريات وسندات القبض والصرف على عقود يملكها السياق
المصدر، ولا تنشئ أي خدمة منها تنفيذًا خرسانيًا تابعًا لسياق آخر. تُنشأ التنفيذات وتُربط
حصرًا في `composition/create-financial-document-services.ts`، وهي نقطة التركيب المعتمدة
للخادم وبيئات الاختبار وبيانات العرض.

## الحدود المطبقة

- تعتمد Sales على `TaxQuotePort` و`InventoryInvoiceCatalogPort` و
  `InventoryInvoiceStockPort` و`ReceivableInvoicePort`.
- تعتمد Purchases على المنافذ الثلاثة الأولى و`PayableInvoicePort`.
- تعتمد Receipts على `TreasuryInstrumentPort` و`RealizedFxAccountPort` و
  `ReceivableSettlementPort`.
- تعتمد Payments على `TreasuryInstrumentPort` و`RealizedFxAccountPort` و
  `PayableSettlementPort`.
- تبقى الكتابة في عناصر الذمم لدى AR/AP، والكتابة في أدوات النقد لدى Treasury،
  وحساب الضريبة لدى Tax، وحركة المخزون لدى Inventory.
- جميع المدخلات الخاصة بالشركة تعبر المنفذ ومعها `companyId` أو معاملة Prisma المقيدة؛
  لا يضيف التركيب مخزنًا جانبيًا أو معاملة موزعة.

## سبب منع fallback داخل الخدمة

كان constructor الاختياري مثل `taxes ?? new TaxService(prisma)` يجعل العلاقة الفعلية
بين السياقات مخفية ويتيح للاختبار أو مسار تشغيل جديد تجاوز نقطة التركيب. الاعتماد الإلزامي
يجعل الرسم المعماري قابلًا للفحص، ويمنع تبديل التنفيذات المتشابهة، ويحافظ على Modular
Monolith من دون إدخال شبكة أو Broker غير مطلوبين.

## الحارس ومعايير الخروج

- يفشل الحارس المعماري إذا ظهر داخل الخدمات الأربع إنشاء مباشر لأي تنفيذ تابع لـTax أو
  Inventory أو AR/AP أو Treasury أو Realized FX.
- يثبت الحارس وجود منفذي دورة الفاتورة في AR/AP ووجود التركيب الخرساني في composition.
- يجب أن ينجح TypeScript للمصدر والاختبارات، واختبارات الحدود والاستعلامات والتسويات.
- يجب تشغيل تكامل Sales/Purchases/Receipts/Payments وPOS وData Import وProfessional
  Billing على قاعدة البيانات.
- تظل بوابتا MariaDB 10.11 وMySQL 8.4 شرطًا قبل الدمج؛ لا يسمح نجاح إحداهما بتجاوز الأخرى.

## دليل التنفيذ المحلي

بتاريخ 2026-08-29 نجح فحص TypeScript للمصدر والاختبارات، ونجحت 50 حالة مركزة للحواجز
المعمارية والاستعلامات والتسويات. نجحت سبعة ملفات تكامل متأثرة و27 حالة على قاعدة
البيانات بعد إعادة حالة تزامن قبض واحدة؛ أظهر التشغيل الأول deadlock عابرًا في اختبار
إنشاء خمسة سندات متزامنة ثم نجح الملف كاملًا منفردًا. لا يعد ذلك مبررًا لإضعاف الاختبار،
ويبقى قياس معدل إعادة المحاولة والإخفاق تحت الحمل جزءًا من سياسة التزامن وبوابات الإصدار.
