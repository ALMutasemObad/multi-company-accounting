---
title: "Bank Statement Parser Spike Result"
status: "GO for parser adapters only"
date: "2026-08-26"
scope: "Hybrid plan phases 0-1"
---

# نتيجة Spike قارئ كشوف البنك

## القرار

**GO مشروط لطبقة القراءة المعزولة فقط.** ثبتت صلاحية `csv-parse@7.0.2` و`fast-xml-parser@5.11.0` خلف `BankStatementParserPort`. لا يمنح هذا القرار إذنًا لبناء أو نشر قاعدة بيانات المطابقة أو API أو الواجهة؛ تبدأ المرحلة 2 بقرار وتنفيذ مستقلين.

## ما تم تنفيذه

- إصدارات exact في `apps/api/package.json` و`package-lock.json` مع integrity وإشعاري MIT.
- عقد `NormalizedBankStatement` محلي لا يحمل أنواع المكتبتين، وFake ينجح في عقد المنفذ نفسه.
- CSV Profile صريح يدعم signed أو debit/credit، والفواصل والعناوين العربية/الإنجليزية وBOM دون تخمين مالي.
- CAMT.053 يدعم اختلاف namespace، ويقرأ مستندًا وحسابًا واحدًا وخطوط `BOOK`، ويحفظ offsets الزمنية كـmetadata منفصلة.
- SHA-256 للملف وfingerprint حتمي لكل حركة، وحساب كل القيم بـ`Prisma.Decimal` إلى أربع منازل.
- لا Migration ولا Prisma write ولا OpenAPI ولا UI ولا نشر.

## أدلة البوابة

| البوابة | النتيجة |
|---|---|
| Contract + Fake + الحارس المعماري | ناجح |
| CSV comma/semicolon/BOM/Arabic/signed/debit-credit | ناجح |
| CAMT.053 namespace/account/currency/opening/closing/BOOK | ناجح |
| DTD/ENTITY وUTF-8 وformat/extension mismatch | مرفوضة كما يجب |
| الحجم 512KB وعدد 5000 ودقة ≤4 منازل | مطبقة ومختبرة |
| حد 5000 حركة | 203ms على Node 24.19 في بيئة التطوير، واجتاز سقف 4000ms و64MiB؛ يعاد القياس على Node 22 في CI قبل المرحلة 2 |
| TypeScript للمصدر والاختبارات | ناجح |
| مجموعة API كاملة | 182 ناجحًا و74 متجاوزًا مشروطًا بالبيئة، بلا فشل |
| بناء workspaces | ناجح |
| `npm audit --omit=dev --omit=optional` | 0 ثغرات production |
| Full audit | 3 high في أداة Prisma التطويرية عبر `deepmerge-ts`؛ ليست من القارئين ولا تدخل production audit، ولم يطبق downgrade قسري |
| الرخص وNOTICE وخطة الخروج | مكتملة |

## القيود المقصودة قبل المرحلة 2

- لا OFX، ولا أكثر من statement داخل ملف CAMT، ولا multi-currency statement.
- لا persistence أو deduplication بين الاستيرادات؛ البصمات جاهزة لكن فرض uniqueness من اختصاص المرحلة 2.
- لا matching engine أو RBAC أو Audit أو شاشة مستخدم.
- يعاد قياس الأداء على صورة Node المستخدمة في CI والإنتاج عند تحويل الـSpike إلى ميزة.

## بوابة الانتقال التالية

قبل المرحلة 2 يلزم اعتماد تصميم جداول التوسعة وOpenAPI والصلاحيات والـAudit وIdempotency والتزامن وFeature Flag. تبقى الكتابة المحاسبية خارج القارئ والمطابقة، وأي مستند مالي لاحق يمر بالخدمات الحالية و`PostingEngine`.
