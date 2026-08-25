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
Application root: accounting-app/releases/<release-id>
Application startup file: apps/api/dist/server.js
Application mode: Production
Node.js version: 22.23.2
Passenger log: logs/accounting-passenger.log
```

يسجل CloudLinux Node.js Selector جذر التطبيق وبيئة Node على مسار الإصدار الفعلي داخل `releases`، ولا يتبع رابط `current` عند تبديله. لذلك يبقى `current` مؤشرًا تشغيليًا للتدقيق، بينما يعيد مسار النشر إنشاء تسجيل Selector من الإصدار السابق إلى الإصدار الجديد مع الحفاظ على متغيرات البيئة المحمية. لا تغيّر `PassengerAppRoot` أو `PassengerNodejs` يدويًا بين الإصدارات.

يخدم Express ملفات React المبنية من `apps/web/dist` مباشرة، لذلك لا يحتاج هذا المسار إلى إعداد Nginx أو PM2. أما مسار VPS الموثق في `production-operations.md` فيبقى متاحًا لبيئة تملك صلاحيات root.

## بوابات ما قبل النشر

1. يجب نجاح وظيفتي GitHub Actions: بوابة MySQL 8.4 وبوابة iFastNet التي تستخدم Node.js 22.23.2 وMariaDB 10.11.11.
2. نزّل Artifact `mcap-finance-linux-x64` من تشغيل ناجح فقط، ثم تحقق من ملف SHA-256.
3. أنشئ نطاقًا فرعيًا مستقل الجذر؛ لا تشارك `public_html` مع النطاق الرئيسي.
4. تحقق من تفعيل `mod_rewrite` وعدم وجود كتلة تحويل متعارضة؛ يثبت مسار النشر المعتمد تحويل HTTPS المُدار تلقائيًا ويفحصه على النطاق العام.
5. أنشئ قاعدة ومستخدمًا جديدين مخصصين للنظام. لا تعِد استخدام قواعد `doralash_books` أو `doralash_tarafu` أو مستخدميهما.
6. لا تشغّل `prisma:seed` أو `prisma:seed:demo` في الإنتاج.

## النشر التلقائي المعتمد

تتضمن `.github/workflows/ci.yml` مهمة `Deploy production to iFastNet`. لا تبدأ هذه المهمة إلا عند الدفع إلى `main` وبعد نجاح بوابتي MariaDB 10.11 وMySQL 8.4 كاملتين. تنزّل Artifact الذي بُني داخل التشغيل نفسه، وتتحقق من SHA-256، وتتصل بمفتاح نشر مخصص وبصمة SSH مثبتة في `deploy/ssh/ifastnet_known_hosts`، ثم تنفذ بالترتيب:

1. نسخة قاعدة بيانات مشفرة إلى `/home/doralash/backups/mcap`.
2. `prisma migrate deploy` على الإصدار المرشح قبل تفعيله.
3. Seed المرجعيات الإنتاجية المتكرر والآمن.
4. تبديل رابط `current` وإعادة إنشاء تسجيل CloudLinux وبيئة Node على جذر الإصدار immutable الجديد.
5. حفظ `.htaccess` ثم تثبيت كتلة `308` مُدارة إلى النطاق المعياري بعد إعادة تشغيل التسجيل، مع استعادة الملف والتسجيل السابقين عند الفشل.
6. فحص `/ready` وبصمة واجهة الإصدار الجديد، ثم فحص HTTP العام و`Location` والمسار والاستعلام قبل قبول النشر، مع رجوع التطبيق تلقائيًا عند فشل التفعيل أو الجاهزية.

يحتاج النشر إلى أربعة أسرار GitHub داخل بيئة `production` المقيدة بفرع `main`:

```text
CPANEL_SSH_PRIVATE_KEY=<private half of the dedicated deployment key>
BACKUP_ENCRYPTION_PASSPHRASE=<single-line random secret, at least 32 characters>
METRICS_BEARER_TOKEN=<separate single-line random secret, 32 to 500 characters>
MIGRATION_DATABASE_URL=mysql://<dedicated-ddl-user>:<secret>@<host>:3306/<production-database>
```

لا تستخدم مفتاح SSH شخصيًا، ولا تغيّر ملف `deploy/ssh/ifastnet_known_hosts` إلا بعد التحقق من بصمة الخادم عبر قناة موثوقة. قيمة تشفير النسخ مطلوبة للاستعادة؛ احتفظ بنسخة منها في مدير أسرار مستقل عن حساب الاستضافة. لا تعرض GitHub قيمة سر محفوظ ولا تنقله بين المستودع والبيئة؛ أعد إدخاله من مدير الأسرار، وأثبت نشرًا ناجحًا من Environment secret قبل حذف أي نسخة أوسع. لا تصل أسرار الإنتاج إلى وظائف Pull Request؛ كما يرفض `deploy-production` الالتزام الذي لم ينتج عن PR واحد مدمج إلى `main` أو نتج عن Force Push قبل قراءة الأسرار. يجب أن يشير `MIGRATION_DATABASE_URL` إلى قاعدة ومضيف `DATABASE_URL` نفسيهما لكن إلى حساب مستقل يملك DDL، ولا يوضع مطلقًا في Node.js Selector أو Passenger أو `.env.production` أو Artifact.

يمرر Workflow عبارة النسخ ورمز القياسات وعنوان الترحيل إلى المضيف عبر `stdin`. يستخدم عنوان الترحيل للنسخة السابقة للترحيل و`prisma migrate deploy` وSeed فقط. قبل أي DDL يشغّل الإصدار المرشح `SHOW GRANTS FOR CURRENT_USER()` على الحسابين، ويرفض النشر ما لم يكونا مختلفين وعلى القاعدة نفسها وما لم يقتصر حساب التشغيل على `SELECT/INSERT/UPDATE/DELETE`. لا يطبع الفاحص أسماء الحسابات أو المضيف أو عناوين الاتصال أو كلمات المرور؛ يطبع تقرير قبول منقحًا فقط. يكتب سكربت النشر رمز القياسات مؤقتًا بتهيئة `0600`، ويدمج `METRICS_ENABLED=true` والرمز في لقطة بيئة CloudLinux للهدف فقط، ثم يحذف الملف في جميع حالات الخروج. تبقى لقطة المصدر مستقلة لاستعادة البيئة السابقة كما كانت عند فشل الإنشاء أو الجاهزية. بعد التفعيل يثبت Workflow أن `/metrics` يعيد `401` بلا رمز وأن الكشط الموثق ينجح، ويرفض النشر إذا وجد قاعدة تنبيه نشطة.

## تثبيت الإصدار

بعد رفع ملفات Artifact إلى مجلد خاص بالحساب، اضبط القيم الفعلية ثم شغّل المثبت من Terminal:

```bash
export MCAP_DEPLOY_ROOT=/home/doralash/accounting-app
export MCAP_NODE_BIN=/opt/alt/alt-nodejs22/root/usr/bin/node
export MCAP_NPX_CLI=/opt/alt/alt-nodejs22/root/usr/lib/node_modules/npm/bin/npx-cli.js
export MCAP_HEALTH_URL=https://accounting.doralashab.com/ready
export MCAP_APP_URL=https://accounting.doralashab.com
export MCAP_PASSENGER_CONFIG_FILE=/home/doralash/accounting.doralashab.com/.htaccess
export MCAP_CLOUDLINUX_SWITCHER="$PWD/deploy/scripts/switch-cloudlinux-registration.sh"
export MCAP_CLOUDLINUX_SELECTOR=/usr/sbin/cloudlinux-selector
export MCAP_CLOUDLINUX_USER=doralash
export MCAP_CLOUDLINUX_HOME=/home/doralash
export MCAP_CLOUDLINUX_DOMAIN=accounting.doralashab.com
export MCAP_CLOUDLINUX_VERSION=22.23.2
export MCAP_CLOUDLINUX_PASSENGER_LOG_FILE=/home/doralash/logs/accounting-passenger.log
export MCAP_CLOUDLINUX_BACKUP_DIRECTORY=/home/doralash/accounting-app/recovery-backups
export MCAP_DEPLOY_CONFIRM=DEPLOY:<release-id>
bash deploy/scripts/install-cpanel-release.sh \
  mcap-finance-linux-x64.tgz \
  <trusted-sha256>
```

يتحقق المثبت من البصمة وManifest والمنصة، ويفك الإصدار إلى مجلد مستقل، ويبدّل رابط `current`، ثم يستدعي `switch-cloudlinux-registration.sh`. يأخذ المحوّل لقطة محمية من تسجيل Selector وبيئته ومن `.htaccess`، يزيل تسجيل المصدر، وينشئ تسجيل الهدف على مساره immutable، ثم يضيف كتلة تحويل HTTPS مُدارة لا تستخدم `HTTP_HOST`؛ وإذا فشل الإنشاء أو إعداد التحويل يعيد التسجيل والملف السابقين تلقائيًا. بعد ذلك لا يكتفي المثبت بفحص `/ready`، بل يقارن بصمة HTML المقدّم عبر النطاق مع `apps/web/dist/index.html` في الإصدار المتوقع حتى لا تعتبر عملية قديمة سليمة إصدارًا ناجحًا. الرجوع يعيد إنشاء تسجيل الإصدار السابق ولا يحذف مجلدات الإصدارات.

المسار اليدوي أعلاه مخصص للطوارئ. الإصدارات الاعتيادية تنشرها مهمة CI تلقائيًا باستخدام `deploy/scripts/deploy-cpanel-release.sh`، وهي تضيف النسخ المشفر والترحيلات والـSeed قبل استدعاء المثبت الذري.

## إعداد التطبيق وقاعدة البيانات

أضف متغيرات الإنتاج من `.env.production.example` في Node.js Selector. يجب أن يكون `WEB_ORIGIN` هو رابط HTTPS نفسه، وتبقى `SESSION_COOKIE_SECURE` و`TRUST_PROXY` مفعّلتين. عند تفعيل التسجيل الذاتي أضف أسرار Resend و`REGISTRATION_AUDIT_PEPPER` و`REGISTRATION_TOKEN_SECRET`؛ وإذا بقيت استعادة كلمة المرور مفعلة فتبقى أسرار Resend ومفتاح الرمز مطلوبة حتى مع `SELF_REGISTRATION_ENABLED=false`. لا تحفظ كلمة مرور قاعدة البيانات أو كلمة مرور المدير أو مفاتيح البريد في Git أو داخل ملفات Artifact.

أنشئ مستخدمين لقاعدة الإنتاج: حساب تشغيل يملك `SELECT, INSERT, UPDATE, DELETE` فقط على قاعدة التطبيق، وحساب ترحيل مستقل يملك صلاحيات DDL/DML اللازمة عليها. ضع عنوان حساب التشغيل وحده باسم `DATABASE_URL` في Selector، وضع عنوان حساب الترحيل وحده باسم `MIGRATION_DATABASE_URL` في أسرار بيئة GitHub `production`. لا تمنح حساب التشغيل `CREATE` أو `ALTER` أو `DROP` أو `INDEX` أو `REFERENCES` أو `TRIGGER` أو `EVENT` أو `EXECUTE` أو `ALL PRIVILEGES`.

أضف أيضًا مهلات `HTTP_*` و`API_*` بالقيم النموذجية مع إبقاء مهلة Passenger/Apache الخارجية أكبر من 70 ثانية. `server.ts` يضبط مهلات Node حتى تحت Passenger، لكن حد الاستضافة الخارجي يملكه المزود؛ تحقق منه قبل رفع Budget التسجيل. عند تفعيل `/metrics` يلزم `METRICS_BEARER_TOKEN` مستقل، وينبغي تقييد المسار بعنوان منصة المراقبة من cPanel/Apache متى أمكن إضافة إلى Bearer. لا تستخدم Session المستخدم للكشط ولا تحفظ الرمز في Git أو Access URL. راجع [دليل المرونة التشغيلية](operational-resilience.md) لهرم القيم وقواعد التنبيه.

بعد النشر تحقق من ظهور شاشة «نسيت كلمة المرور»، وراقب Outbox حسب `event_type='PasswordResetRequested'` وسجل الأمان حسب `event_type='PASSWORD_RESET_COMPLETED'`. لا تختبر الإنتاج بحساب حقيقي ذي جلسات لازمة، لأن نجاح الاستعادة يلغي جميع جلساته عمدًا.

قبل تشغيل التطبيق لأول مرة فقط، طبّق الترحيلات بحساب DDL المستقل، ثم شغّل المرجعيات الإنتاجية وجهّز شركة العميل. لا تستخدم هذا المسار اليدوي الاعتيادي إلا من جلسة طوارئ محمية، ولا تحفظ عنوان DDL في سجل الأوامر:

```bash
cd /home/doralash/accounting-app/current
cd apps/api
DATABASE_URL="$MIGRATION_DATABASE_URL" "$MCAP_NODE_BIN" "$MCAP_NPX_CLI" --yes prisma@7.9.1 migrate deploy
cd ../..
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run database:seed-reference
npm run company:provision
```

أمر `company:provision` يحتاج متغيرات `PROVISION_*` والتأكيد المطابق الموثق في `production-operations.md`. احذف كلمة مرور المدير المؤقتة من جلسة الطرفية بعد انتهاء الأمر، ثم غيّرها عبر إجراء تسليم آمن للعميل.

## النسخ والرجوع

الاستضافة المشتركة لا توفر systemd أو صلاحية إدارة binlogs. لذلك ينفذ `production-backup-dr.yml` النسخ عند `01:43 UTC` يوميًا من خلال اتصال SSH مضبوط، ويحفظ النسخة المشفرة خارج حساب الاستضافة كـGitHub Artifact مدة 90 يومًا. يعيد التشغيل الأول من كل شهر النسخة الفعلية إلى MariaDB 10.11.11 معزولة، بينما يفحص مراقب ساعي عمر Artifact بحد محافظ 25.5 ساعة لحماية RPO البالغ 26 ساعة، وعمر آخر تمرين ناجح بحد 35 يومًا، وأي علامة فشل أحدث. لا تضع عبارة التشفير أو عنوان حساب الترحيل في Cron أو Selector؛ كلاهما يبقى سرًا في بيئة `production` ويمر عبر `stdin`. راجع [دليل التعافي](production-disaster-recovery.md) لإجراء الفقد الكامل وتدوير المفتاح.

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
