# ADM-1B7 — محول استعمال الحسابات في Inventory

## النتيجة

- أضيف `InventoryAccountUsageQueryAdapter` المملوك لـInventory، ويعد بعزل الشركة
  كل `InventoryMovement.offsetAccountId` ضمن فئة
  `INVENTORY_MOVEMENT_HISTORY`. أي عدد موجب تاريخ غير قابل للتغيير لأن حالات
  الحركة المحفوظة `POSTED/REVERSED`.
- أصبح تركيب الخادم كاملًا 7/7، مع إبقاء `enforcementEnabled=false` وعدم حقن
  `AccountUsageGuard` في `AccountService`.
- الحركة اليدوية المحاسبية تقفل offset على `TransactionClient` نفسها، ثم تعيد حل
  السياسة تحت القفل وتفشل مغلقًا إذا تغير المعرّف أو بطلت الفئة/الأهلية قبل كتابة
  الحركة.
- لا تقفل Inventory حسابي inventory/COGS الديناميكيين؛ مرجعهما الدائم هو
  `JournalLine` ويملكه Core/Posting Engine. ولا يعاد قفل offset عند نسخه في حركة
  العكس، لأن المرجع التاريخي موجود أصلًا والنسخ لا ينشئ أول استعمال؛ يبقى عكس
  التاريخ الصحيح ممكنًا إذا صار الحساب غير نشط.

## بوابة التفعيل المتبقية

قبل حقن الحارس في دورة حياة Account، يجب أن يقفل Posting Engine جميع account IDs
الفريدة والمرتبة للقيد على المعاملة نفسها قبل فحص الحارس. لا يكفي اكتمال المحولات
7/7 لتجاوز هذه البوابة.

## التحقق

- قبل تثبيت الاعتمادات محليًا: C الحر `17.1 GB` وE الحر `78.1 GB`. استخدم
  `npm ci --cache E:/DevelopmentCaches/npm --prefer-offline` داخل worktree فقط، ثم
  `prisma generate` بعنوان قاعدة وهمي للتوليد فقط؛ لم تشارك `node_modules`.
- `vitest run` للاختبارات المركزة للمحول وwriter handshake وcomposition والحركة:
  `23/23` ناجحًا.
- `node --test scripts/tests/architecture-boundaries.test.mjs`: `50/50` ناجحًا.
- `npm run typecheck -w @mcap/api`: ناجح لتطبيق API واختباراته.
- `git diff --check`: ناجح؛ تحذيرات تحويل LF/CRLF المحلية ليست أخطاء diff.

لم تتغير قاعدة البيانات أو OpenAPI، ولم يحدث push أو PR أو نشر. لا يوجد فهرس
مخصص موثق لـ`(companyId, offsetAccountId)` في هذه الشريحة؛ قياسه وإضافة migration
إن ثبتت الحاجة عمل لاحق منفصل. لم تشغّل حزمة قاعدة البيانات الكاملة؛ لا توجد قاعدة
اختبار حية مطلوبة لهذه الشريحة. أبلغ `npm audit` بعد التثبيت عن ثغرتين متوسطتين في
baseline الاعتمادات ولم تُغيّر الحزم أو ملف القفل ضمن هذا العمل.
