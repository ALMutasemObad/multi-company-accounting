# قفل حسابات Posting Engine المركزي

## النتيجة

- يقفل `PostingEngine` مجموعة `accountId` النهائية بعد `beforeLedger`، مع إزالة
  التكرار والترتيب الرقمي وعزل الشركة، وقبل validation أو أي كتابة `JournalLine`.
- يغطي القفل `postPlan` و`postExisting` و`reverse`. يفشل المسار مغلقًا إذا غاب أي
  حساب من الشركة. post الحالي يعيد فحص active/posting/leaf، بينما reverse التاريخي
  يقبل حسابًا inactive إن كان موجودًا في الشركة لأنه ينسخ قيدًا immutable.
- يحجز reverse sequence بعد فحص الفترة/المستند/النسخة وقبل hooks وأقفال
  Account/JournalLine، لتثبيت ترتيب Sequence→Account→JournalLine.
- ينسخ `PostingEngine` الخطة النهائية بعد `beforeLedger` إلى snapshot مستقل يملكه
  وحده؛ القفل والتحقق والكتابة كلها تستخدم هذه النسخة. يعمل hook
  `afterAccountLocks` بعد التحقق وقبل الكتابة، ولا يستطيع عبر closure تغيير
  الحسابات أو المبالغ أو line numbers أو التاريخ/العملة في الخطة المكتوبة.
- يعيد Sales داخل `afterAccountLocks` قراءة مجموعة revenue المحفوظة ويتحقق من
  تطابقها ومن بقاء كل حساب active/posting/leaf ومن فئة REVENUE؛ أي تبدل بين
  التجهيز والقفل يفشل مغلقًا.
- أزيل قفل Inventory offset المحلي الجزئي. يعاد حل سياسة inventory/offset
  المتخصصة داخل hook ومقارنتها بالقيم التمهيدية تحت الأقفال المركزية.
- تغير Purchases posting lines قبل القفل، ويحفظ استبدال snapshot في
  `PurchaseInvoiceLine` من post-lock hook فقط، من دون قفل Account جزئي محلي.
- صارت updates في Sales/Purchases/Receipt/Payment تقفل `AccountingDocument` أولًا،
  ثم تعيد قراءة status/version والبيانات تحت القفل، ثم تقفل الحسابات المصرح بها
  وتنفذ CAS. أما Sales post فيجهز revenue accounts بوضع validate-only ويترك القفل
  النهائي للمحرك، لتفادي دورة Account→Document.
- تحجز embedded creates في Sales (POS/import/professional billing) وPurchases import
  رقم المستند على المعاملة نفسها قبل `prepare` وأقفال الحسابات. يبقى فشل التحقق
  بعد الحجز داخل المعاملة فيتراجع معه تحديث التسلسل؛ ومرحلة resolve للاستيراد
  تتحقق بلا قفل حساب مبكر.
- يحجز POS رقم RECEIPT عبر reservation opaque بعد قفل وإعادة قراءة الفترة وقبل
  بدء Sales checkout. يمرر المنسق الحجز إلى Receipt capture، الذي يطابق الشركة
  والفترة والتاريخ ويستهلك الرقم بلا reserve ثانٍ؛ فيصبح graph المركب
  Sequence(RECEIPT)→Sequence(SALES)→Account بدل Account→Sequence.

## بوابات التفعيل المتبقية

يبقى `AccountUsageGuard.enforcementEnabled=false` ولا يحقن في `AccountService`.
قبل التفعيل يلزم بروتوكول مستقل لكتابة draft JournalLines في `ManualJournal`
create/update، وبروتوكول writer لـ`Account.parentAccountId` بترتيب أقفال موحد، ثم
اختبارات تنافس فعلية على MySQL/MariaDB. لم توسع هذه الشريحة لمعالجة تلك المسارات.

## أثر الباركود

لا تتغير رحلة إدخال الصنف أو البحث أو المسح أو OpenAPI أو واجهة المستخدم. التغيير
محصور في ترتيب أقفال الترحيل وحفظ account snapshot داخل المعاملة؛ لا يضيف parser
أو lookup أو حقل barcode ولا يتجاوز تأكيد أو صلاحية قائمة.

## التحقق

- قياس ما قبل التثبيت: C الحر `16.9 GB` وE الحر `77.5 GB`. نفذ `npm ci` داخل
  worktree فقط وبـ`E:/DevelopmentCaches/npm` ثم `prisma generate` بعنوان وهمي
  للتوليد فقط؛ لم تشارك `node_modules`.
- focused Vitest: `43/43` ناجحًا (PostingEngine وInventory/Purchases/Sales/Treasury
  handshakes وPOS orchestration وcomposition).
- API architecture guardrails: `52/52` ناجحًا.
- TypeScript typecheck لتطبيق API واختباراته: ناجح.
- architecture boundaries: `50/50` ناجحًا.

لم تتغير schema أو OpenAPI أو ملفات الاعتماد، ولم يحدث push أو PR أو نشر. لم تشغّل
حزمة قاعدة البيانات الكاملة؛ التحقق التنافسي الفعلي جزء من بوابة التفعيل التالية.
أبلغ baseline `npm audit` عن ثغرتين متوسطتين ولم تعدل الاعتمادات في هذه الشريحة.
