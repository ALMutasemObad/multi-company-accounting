---
title: "Barcode Label Rendering B2"
status: "implemented locally; Staging merge pending dual-engine gates; full-support/Production pending physical-device evidence"
version: "1.0"
date: "2026-08-29"
related:
  - "MOBILE_AND_BARCODE_CHANNELS_GOAL_AR.md"
  - "INVENTORY_CONTEXT_FOUNDATION_AR.md"
  - "OPEN_SOURCE_MODULE_ADOPTION_POLICY_AR.md"
  - "OPENAPI_EXECUTABLE_CONTRACTS_AR.md"
---

# شريحة إخراج ملصق الباركود B2

## 1. النطاق المنفذ

تملك **Printing & Document Output** توليد الصورة، وتستهلك لقطة قراءة صغيرة من
**Inventory** عبر `InventoryBarcodeLabelQueryPort`. ينفذ محول Prisma المملوك
لـInventory القراءة بالشركة ومعرفي الصنف والباركود، ولا يعيد إلا السجلين
النشطين. لا تقرأ Printing نموذج Inventory مباشرة، ولا تكتب فيه.

ينشر العقد:

`GET /api/v1/inventory-items/{inventoryItemId}/barcodes/{barcodeId}/label.png`

- الصلاحية المستقلة `inventory_barcodes.print`.
- الشركة من الجلسة، ويعود `404` نفسه للسجل المفقود أو المعطل أو التابع لشركة أخرى.
- الاستجابة `image/png` و`Cache-Control: no-store`.
- اسم الملف مشتق من المعرفين الرقميين فقط؛ لا يضع قيمة الباركود في ترويسة.
- يسجل Audit التنزيل بمعرفي الصنف والباركود والنوع والبروفايل، ولا يسجل القيمة الخام أو المطبعة.

## 2. بروفايل الملصق الثابت

البروفايل `INVENTORY_203_DPI_V1` ثابت، ولا يقبل الطلب مقاسًا أو DPI أو لونًا أو عدد
نسخ أو نوعًا غير مملوك. يستخدم أسود على أبيض، ووحدة رسم 3 بكسل للرموز الخطية
مع ارتفاع 16mm ونص مقروء بشريًا وهامش أفقي 12 وحدة على الأقل. يستخدم QR وحدة
4 بكسل وquiet zone مقدارها أربع وحدات. يفشل الرسم إذا لم يكن المخرج PNG صحيحًا أو
تجاوز 2MiB.

الأنواع المكشوفة فقط: `EAN_13`, `EAN_8`, `UPC_A`, `CODE_128`, `QR`. لا GS1/FNC1، ولا
PDF أو ZPL/EPL، ولا دفعات ملصقات في B2.

## 3. تقييم المصدر المفتوح

| الخيار | النتيجة |
|---|---|
| `@bwip-js/node` | المختار؛ حزمة Node مخصصة تنتج PNG محليًا وتغطي الأنواع الخمسة خلف Adapter واحد. |
| حزمة `bwip-js` متعددة القنوات | لم تختر للخادم؛ توسع سطح التوزيع للمتصفح بلا حاجة في هذه الشريحة. |
| دمج محرك خطي مع محرك QR منفصل | لم يختر؛ يضيف اعتمادين وبروفايلين ومساري تحقق بدل حد واحد. |
| بناء encoder محلي | مرفوض؛ خطر الانحراف في check digits وquiet zones والرسم أعلى من طبقة التكييف. |

الاعتماد المثبت:

- الحزمة: `@bwip-js/node` بالإصدار الدقيق `4.11.2`.
- المصدر: `https://github.com/metafloor/bwip-js`.
- الرخصة: MIT، وحُفظ الإشعار في `THIRD_PARTY_NOTICES.md`.
- بصمة npm: `sha512-5Us0cTcMFZZsDi+GKkruRrsnjiaZ3dzeTJBawDCQ6Ux7ebERMhyuM/EOnB0B9vm3wS7Tgtbhpv2h37wZog+lPw==`.
- الحجم المفكوك المعلن: `5,932,341` بايت، ولا توجد runtime dependencies للحزمة.
- يثبت `package-lock.json` الإصدار والبصمة، ونجح فحص npm عند التركيب بصفر ثغرات مكتشفة في شجرة المشروع وقت الفحص.
- لا يرسل المحرك بيانات إلى شبكة؛ الرسم محلي داخل عملية API وخارج معاملة قاعدة البيانات.

## 4. التحديث وخطة الخروج

مالك الاعتماد هو فريق Printing & Document Output. تراجع التحديثات والنشرات الأمنية ربع
سنويًا وقبل كل إصدار، ولا ترقى الحزمة من دون إعادة اختبار الأنواع الخمسة وPNG
والقياس والمسح من artifact النهائي. خطة الخروج هي استبدال `BarcodeLabelRendererPort` وحده؛ لا
تخزن المنصة PNG أو نوعًا خاصًا بالمكتبة، ولا تتسرب أنواعها إلى Inventory أو OpenAPI.

## 5. بوابات Staging والأدلة المتبقية قبل الدعم الكامل

الاختبار الآلي يثبت توقيع PNG، والعزل، ومسار input → render → resolve، وعدم تسرب القيمة في
الترويسات أو Audit. لا يعد هذا دليل طباعة فعلية. يشترط دمج المرشح إلى Staging نجاح:

1. نجاح الترحيل والاختبار على MariaDB 10.11 وMySQL 8.4.

وقبل إعلان «دعم باركود كامل» أو إطلاق Production يلزم كذلك:

2. فك الرمز من PNG النهائي بdecoder مستقل، ثم من ملصق مطبوع بطابعة 203 DPI فعلية.
3. توثيق الطابعة والقارئ والورق والمسافة والإضاءة وأي عينة فشلت.
4. قياس p50/p95/p99 قبل اعتماد SLO أو توسيع المسار إلى دفعات أو PDF.

لذلك لا تسمى B2 وحدها «دعم باركود كامل»، ولا يغلق دمجها في Staging بوابة الأجهزة
المادية أو يمنح تصريح Production.
