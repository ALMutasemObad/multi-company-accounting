---
title: "أساس الدخول عبر Google وApple"
status: "foundation only — not user-facing"
last_updated: "2026-09-06"
owner: "Identity & Access"
---

# أساس الدخول عبر Google وApple

## حدود القرار

هذه الشريحة تثبت سياسة الهوية والربط ومعاملة التفويض فقط. لا تضيف Route عامًا، ولا
تنشئ جلسة، ولا تحفظ رمزًا أو Secret، ولا تجعل زرًا ظاهرًا. يظل `Identity & Access`
مالك الهوية والجلسة، وتبقى جلسة الخادم الحالية وCSRF وRBAC وعزل الشركة كما هي.

## الهوية الدائمة

المفتاح الفريد لهوية المزود هو `(issuer, subject)` بعد تحقق OIDC كامل. يخزن Google
بالمُصدر القانوني `https://accounts.google.com` بعد قبول المصدر القديم الموثق
`accounts.google.com` عند التحقق فقط، ويخزن Apple بالمصدر
`https://appleid.apple.com`. `provider` تصنيف تشغيلي وليس بديلًا عن `issuer`.

لا يعد البريد مفتاح هوية، حتى إن كان `email_verified=true`. قد يتغير البريد، وقد
يستخدم Apple عنوان Private Relay، وقد لا يطابق بريد الحساب المحلي. إذا طابق بريد
هوية غير مرتبطة حسابًا قائمًا فالنتيجة الداخلية هي طلب إثبات ملكية الحساب، لا دمج
تلقائي ولا كشف عام لوجود الحساب.

عنوان Apple ذي النطاق `privaterelay.appleid.com` يحفظ بوصفه عنوان اتصال relay مع
علامة صريحة. لا يستنتج منه البريد الحقيقي، ويلزم قبل مراسلته تسجيل مصادر الإرسال
وضبط SPF/DKIM وفق Apple. كائن `user` الذي يحمل الاسم والبريد يصل في أول تفويض فقط؛
لذلك يعالج كبيانات ملف اختيارية تحفظ ذرّيًا مع إنشاء الحساب، بينما تظل الهوية من
`iss + sub`. تغير البريد لاحقًا يحدث سمة الاتصال بعد سياسة تحقق مستقلة ولا يغير
الرابط.

## رحلة التفويض والتحقق

الرحلة المطلوبة لاحقًا هي Authorization Code مع PKCE `S256` لكل من المزودين:

1. ينشئ الخادم `state` و`nonce` و`code_verifier` عشوائية عالية الإنتروبيا، ويرسل
   `code_challenge`. تحفظ القيم كبصمات أو في سجل خادمي قصير العمر مربوط بجلسة
   `PRE_AUTH` أو جلسة المستخدم عند الربط، مع ارتباط مستقل بالمتصفح البادئ والمزود
   والغرض وعنوان العودة المسموح. `state` وحده لا يثبت هذا الارتباط.
2. تكون المعاملة أحادية الاستخدام؛ يرفض اختلاف المزود أو `state` أو `nonce`، أو
   الانتهاء أو إعادة الاستخدام أو غياب رابط PKCE. يستهلك السجل ذرّيًا مع نجاح
   القرار لتفادي السباق.
3. تتولى مكتبة OIDC موثوقة تبادل `code` والتحقق من توقيع JWS عبر مفاتيح المزود،
   والخوارزمية المسموحة و`iss` واحتواء `aud` على Client ID و`exp` و`nonce`. لا
   يفك التطبيق JWT ليبني ثقة، ولا يكتب crypto/JWKS cache يدويًا.
4. بعد ذلك فقط تنتج المكتبة Adapter profile موثوقًا للنواة النقية. لا تسجل الرموز
   أو code/verifier/nonce أو client secret. لا يلزم access/refresh token لهذه
   الشريحة؛ عدم وجود استعمال متعاقد عليه يعني عدم تخزينهما.

Google يعيد Authorization Code إلى callback عادي. Apple يفرض `form_post` عند طلب
`name` أو `email`، ويصل callback كـ`application/x-www-form-urlencoded`. لذلك يجب أن
يكون Route Apple قادرًا على body محدود الحجم لهذا النوع، وأن يستخدم `state` أحادي
الاستخدام كحماية Login CSRF. لا يستطيع POST الصادر من Apple إرسال `X-CSRF-Token`؛
فلا يعاد استخدام حارس JSON الحالي حرفيًا.

يجب اختبار Cookie العبور في المتصفحات المستهدفة. POST عبر موقع آخر لا يرسل عادة
Cookie `SameSite=Lax`؛ التصميم الآمن المفضل هو correlation cookie قصيرة العمر
محددة المسار `Secure; HttpOnly; SameSite=None` مع سجل خادمي وبصمة state، أو معرّف
opaque داخل state موقّع/مربوط بالسجل دون وضع أسرار أو وجهة حرة فيه. لا تخفف Cookie
الجلسة العامة إلى `SameSite=None`. وبعد callback تكون الاستجابة `303` إلى وجهة
داخلية allow-listed كي لا يعاد إرسال body، مع `Cache-Control: no-store`.

## سياسة الدخول والربط

- هوية مرتبطة + مستخدم نشط: يمكن تدوير جلسة الخادم الحالية إلى جلسة مصادق عليها.
- هوية مرتبطة + مستخدم معطل: رفض؛ لا يعيد المزود تفعيل الحساب.
- هوية غير مرتبطة + بريد حساب قائم: لا دمج. يطلب دخولًا محليًا/هوية مرتبطة أخرى
  تثبت الحساب، ثم إعادة مصادقة حديثة وموافقة صريحة على الربط.
- ربط من إعدادات حساب مصادق: يلزم `auth_time` محلي حديث أو challenge لكلمة المرور/
  عامل قائم، وموافقة تسمي المزود والبريد المعروض. وجود الجلسة وحده غير كاف.
- إذا كانت الهوية مرتبطة بمستخدم آخر يرفض الربط برسالة عامة ويصدر SecurityEvent
  دون subject أو token كاملين.
- إنشاء حساب جديد يحتاج بريد اتصال موثق في النموذج الحالي. غيابه أو عدم توثيقه
  يعيد رحلة جمع/توثيق بريد؛ لا يولد بريدًا وهميًا. عنوان relay الموثق مقبول بوصفه
  بريد اتصال إذا اكتملت جاهزية relay.

هذه النتائج في `apps/api/src/social-auth` قرارات فقط. التخزين، القفل الفريد، تدوير
الجلسة وSecurityEvent مسؤولية Adapter/Service التكامل اللاحق.

## Adapter المقترح

التقييم المبدئي هو `openid-client` من خطه الحالي الذي يوثق Node الحديث وESM؛ يوثق
Authorization Code Grant وPKCE وstate وnonce، ويعالج callback من `Request` بما فيه
POST. قبل إضافته يلزم تسجيل adoption scope مستقل، تثبيت من lockfile، فحص الرخصة
والـSBOM والتنبيهات، وتحديد إصدار بعد Spike يختبر Google وApple فعليًا، بما فيه
`form_post` وdiscovery/metadata والسلوك عند دوران JWKS. لا تثبت هذه الشريحة اعتمادًا
ولا تدعي التوافق العملي مع المزود قبل ذلك الاختبار.

## تغييرات التكامل التي يملك المدير تسلسلها

لا تعدّلها هذه الشريحة. القائمة الدقيقة المقترحة:

- `apps/api/prisma/schema.prisma`: `ExternalIdentity` فريد على
  `(issuer, subject)` ومرتبط بـUser، و`SocialAuthorizationTransaction` قصير العمر
  أحادي الاستخدام؛ جعل `passwordHash` اختياريًا فقط إذا اعتمد المنتج حسابًا
  اجتماعيًا بلا كلمة مرور.
- `apps/api/prisma/migrations/<timestamp>_social_login_foundation/`: قيود وفهارس
  واختبار ترقية/رجوع؛ لا backfill اعتمادًا على البريد.
- `packages/contracts/openapi.yaml` ثم توليد
  `apps/api/src/generated/openapi-request-guards.ts`: start/callback/link/unlink
  ونتائج عامة غير كاشفة، مع media type لـApple.
- `apps/api/src/app.ts` و`apps/api/src/server.ts` وملفات composition: rate limits
  مشتركة، تركيب الإعداد والـAdapter والـRouter، وفشل مغلق إذا غابت الإعدادات.
- `apps/api/src/auth/auth-service.ts` و`auth-store.ts` و`prisma-auth-store.ts`:
  إعادة استعمال تدوير الجلسة الحقيقي، وتوثيق نجاح/فشل وربط/فك الربط.
- Router اجتماعي جديد تحت `apps/api/src/social-auth` بدل توسيع Router كلمة المرور،
  مع parser محدد لـApple `form_post` وحماية state/nonce/PKCE.
- `apps/api/tests/auth.integration.test.ts` و`openapi-request-guards.test.ts`
  و`openapi-route-parity.test.ts`: تكامل جلسة وCSRF وreplay والتعارض والعزل.
- `apps/web/src/api.ts` و`LoginScreen.tsx` و`App.tsx` وملف ترجمة auth: لا تظهر
  الأزرار إلا من endpoint capabilities يؤكد اكتمال إعداد كل مزود.
- `.env.example`/إعداد typed config: Client IDs وredirect URIs وأسماء مراجع secrets؛
  لا قيمة سرية في Git أو المحادثة.

## إعداد المالك المطلوب قبل التفعيل

Google: مشروع/شاشة موافقة وOAuth Web Client، origins وredirect URI HTTPS مطابقان،
وسياسة scopes الدنيا `openid email profile`. Apple: عضوية Developer، App ID أولي
مفعل، Services ID مرتبط به، domains وreturn URLs، Key/Team ID، وتسجيل مصادر البريد
للـPrivate Relay مع SPF/DKIM. تحفظ المفاتيح في Secret Manager/بيئة النشر وتدور؛ لا
ترسل في التذاكر أو المحادثة. غياب أي إعداد يجعل المزود `disabled` ولا يعرض الزر.

## المصادر الأصلية المراجعة في 2026-09-06

- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- Google OIDC API reference: https://developers.google.com/identity/openid-connect/reference
- Apple — Authenticating users: https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple
- Apple — Other platforms و`form_post`: https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms
- Apple — Configuring webpage: https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple
- Apple — Verifying a user: https://developer.apple.com/documentation/signinwithapple/verifying-a-user
- Apple — Web configuration: https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/
- Apple — Private Relay: https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0-18.html
- openid-client API: https://github.com/panva/openid-client/blob/main/docs/README.md
