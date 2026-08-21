# نشر النظام على iFastNet cPanel

## البيئة التي تم التحقق منها

تم فحص خدمة `Super Premium` فعليًا في 2026-08-21 دون تعديل التطبيق أو قواعد البيانات القائمة. البيئة توفر:

- cPanel 138 مع SSH وTerminal وGit Version Control وCron Jobs.
- CloudLinux Node.js Selector؛ الإصدار المطابق المعتمد للنشر هو Node.js 22.23.2.
- MariaDB 10.11.11 بدل MySQL 8.4، لذلك تشغّل CI بوابة توافق كاملة على النسخة نفسها إضافة إلى بوابة MySQL 8.4.
- تطبيق قائم باسم `tarafu.doralashab.com` وقواعد بيانات قائمة؛ جميعها خارج نطاق هذا النشر ولا يجوز تعديلها.

## مخطط النشر

المسار المقترح للنسخة الأولى هو `https://accounting.doralashab.com` باسم محايد، مع:

```text
Application root: accounting-app/current
Application startup file: apps/api/dist/server.js
Application mode: Production
Node.js version: 22.23.2
Passenger log: logs/accounting-passenger.log
```

يجب أن يشير `PassengerAppRoot` في ملف إعداد النطاق إلى المسار المستقر `/home/doralash/accounting-app/current`، لا إلى مجلد إصدار داخل `releases`. يحافظ ذلك على التبديل الذري ويتيح للمُثبّت إيقاظ Passenger عبر لمس ملف الإعداد نفسه.

يخدم Express ملفات React المبنية من `apps/web/dist` مباشرة، لذلك لا يحتاج هذا المسار إلى إعداد Nginx أو PM2. أما مسار VPS الموثق في `production-operations.md` فيبقى متاحًا لبيئة تملك صلاحيات root.

## بوابات ما قبل النشر

1. يجب نجاح وظيفتي GitHub Actions: بوابة MySQL 8.4 وبوابة iFastNet التي تستخدم Node.js 22.23.2 وMariaDB 10.11.11.
2. نزّل Artifact `mcap-finance-linux-x64` من تشغيل ناجح فقط، ثم تحقق من ملف SHA-256.
3. أنشئ نطاقًا فرعيًا مستقل الجذر؛ لا تشارك `public_html` مع النطاق الرئيسي.
4. أنشئ قاعدة ومستخدمًا جديدين مخصصين للنظام. لا تعِد استخدام قواعد `doralash_books` أو `doralash_tarafu` أو مستخدميهما.
5. لا تشغّل `prisma:seed` أو `prisma:seed:demo` في الإنتاج.

## تثبيت الإصدار

بعد رفع ملفات Artifact إلى مجلد خاص بالحساب، اضبط القيم الفعلية ثم شغّل المثبت من Terminal:

```bash
export MCAP_DEPLOY_ROOT=/home/doralash/accounting-app
export MCAP_NODE_BIN=/opt/alt/alt-nodejs22/root/usr/bin/node
export MCAP_NPX_CLI=/opt/alt/alt-nodejs22/root/usr/lib/node_modules/npm/bin/npx-cli.js
export MCAP_HEALTH_URL=https://accounting.doralashab.com/ready
export MCAP_APP_URL=https://accounting.doralashab.com
export MCAP_PASSENGER_CONFIG_FILE=/home/doralash/accounting.doralashab.com/.htaccess
export MCAP_DEPLOY_CONFIRM=DEPLOY:<release-id>
bash deploy/scripts/install-cpanel-release.sh \
  mcap-finance-linux-x64.tgz \
  <trusted-sha256>
```

يتحقق المثبت من البصمة وManifest والمنصة، ويفك الإصدار إلى مجلد مستقل، ويبدّل رابط `current` ذريًا، ثم يلمس `tmp/restart.txt` وملف إعداد Passenger. لا يكتفي بفحص `/ready`؛ بل يقارن بصمة HTML المقدّم عبر النطاق مع `apps/web/dist/index.html` في الإصدار المتوقع حتى لا تعتبر عملية قديمة سليمة إصدارًا ناجحًا. عند فشل إصدار لاحق يعيد الإصدار السابق تلقائيًا. لا يحذف أي إصدار.

## إعداد التطبيق وقاعدة البيانات

أضف متغيرات الإنتاج من `.env.production.example` في Node.js Selector. يجب أن يكون `WEB_ORIGIN` هو رابط HTTPS نفسه، وتبقى `SESSION_COOKIE_SECURE` و`TRUST_PROXY` مفعّلتين. لا تحفظ كلمة مرور قاعدة البيانات أو كلمة مرور المدير في Git أو داخل ملفات Artifact.

قبل تشغيل التطبيق لأول مرة فقط، طبّق الترحيلات بالإصدار المثبت من Prisma، ثم شغّل المرجعيات الإنتاجية وجهّز شركة العميل:

```bash
cd /home/doralash/accounting-app/current
cd apps/api
"$MCAP_NODE_BIN" "$MCAP_NPX_CLI" --yes prisma@7.9.1 migrate deploy
cd ../..
npm run database:seed-reference
npm run company:provision
```

أمر `company:provision` يحتاج متغيرات `PROVISION_*` والتأكيد المطابق الموثق في `production-operations.md`. احذف كلمة مرور المدير المؤقتة من جلسة الطرفية بعد انتهاء الأمر، ثم غيّرها عبر إجراء تسليم آمن للعميل.

## النسخ والرجوع

الاستضافة المشتركة لا توفر systemd أو صلاحية إدارة binlogs. استخدم Cron Job يوميًا لتشغيل `npm run db:backup` إلى مجلد غير عام، وانقل نسخة مشفرة إلى وجهة خارج حساب الاستضافة. اختبر الاستعادة شهريًا في قاعدة معزولة.

للرجوع اليدوي:

```bash
export MCAP_DEPLOY_ROOT=/home/doralash/accounting-app
export MCAP_NODE_BIN=/opt/alt/alt-nodejs22/root/usr/bin/node
export MCAP_HEALTH_URL=https://accounting.doralashab.com/ready
export MCAP_APP_URL=https://accounting.doralashab.com
export MCAP_PASSENGER_CONFIG_FILE=/home/doralash/accounting.doralashab.com/.htaccess
export MCAP_ROLLBACK_CONFIRM=ROLLBACK:<previous-release-id>
bash deploy/scripts/rollback-cpanel-release.sh
```
