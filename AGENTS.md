# تعليمات معمارية إلزامية للوكلاء والمطورين

قبل أي تغيير في المجال أو قاعدة البيانات أو الترحيل أو الأحداث، اقرأ بالترتيب:

1. `docs/architecture/ARCHITECTURE_GUARDRAILS_AR.md`
2. `docs/architecture/BOUNDED_CONTEXT_MAP_AR.md`
3. `docs/architecture/ADR-003-domain-boundaries-and-eventing.md`
4. `docs/architecture/MASTER_DATA_CODE_POLICY_AR.md`
5. `docs/architecture/CONCURRENCY_DEADLOCK_DEADLINE_POLICY_AR.md`
6. `docs/architecture/PASSWORD_RESET_SECURITY_POLICY_AR.md`
7. `docs/architecture/CHANGE_REVIEW_CHECKLIST_AR.md`

قواعد لا يجوز تجاوزها بصمت:

- النظام Modular Monolith؛ لا Microservice أو Broker خارجي دون ADR مقبول.
- لا كتابة مباشرة جديدة إلى Prisma model يملكه Bounded Context آخر.
- لا إنشاء جديد لـ`JournalEntry` أو `JournalLine` خارج Core Accounting/Posting Engine.
- Ledger posting/reversal/settlement invariants تبقى strongly consistent داخل معاملة ACID.
- الأحداث للآثار اللاحقة للـcommit، وتكتب عبر Transactional Outbox في معاملة المجال نفسها.
- لا تستخدم AuditLog أو SecurityEvent أو logs التشغيلية كـOutbox.
- لا Network I/O داخل transaction.
- لا Retry غير محدود أو Retry لأخطاء الأعمال؛ استخدم التصنيف المركزي وbackoff+jitter ضمن deadline واحد.
- اقفل الموارد المتعددة بترتيب ثابت، واختبر post-vs-close والتسويات المتزامنة على قاعدة بيانات فعلية.
- Idempotency لا تستبدل locking أو optimistic version؛ هي تجعل Retry الآمن ممكنًا.
- لا Float أو `Number` للحساب المالي النهائي؛ استخدم `Prisma.Decimal` و`ROUND_HALF_UP`.
- حافظ على company isolation وCSRF/RBAC وIdempotency وOptimistic Version.
- لا تطلب من المستخدم اختراع رمز كيان مرجعي إذا كان مشمولًا بسياسة الرموز؛ ولّد الرمز خادميًا وذريًا ولا تسمح بتعديله.
- لا تكشف استجابة استعادة كلمة المرور وجود الحساب، ولا تخزن الرمز خامًا، وألغِ الجلسات السابقة بعد نجاح التغيير.
- المخالفات الحالية انتقالية وليست نمطًا للنسخ. لا تزدها، وعند لمسها قللها أو وثق سبب التأجيل.

إذا تعارضت المهمة مع هذه القواعد، توقف عن التنفيذ المعماري المخالف، ووضح التعارض واقترح ADR أو قرارًا صريحًا بدل الالتفاف عليه.
