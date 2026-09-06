import React, { useId } from 'react';
import { permissionModule } from '../module-entitlements';
import type { CurrentAuthorization, SubscriptionSnapshot } from '../types';
import './optional-modules.css';

/** The loader must invalidate this envelope on user/company changes or refresh. */
export type OptionalModulesInput = {
  companyId: string;
  userId: string;
  read: { state: 'loading' | 'error' | 'unavailable' } | {
    state: 'ready';
    companyId: string;
    userId: string;
    authorization: CurrentAuthorization;
    snapshot: SubscriptionSnapshot;
  };
};

export function OptionalModulesCatalog({ companyId, userId, read }: OptionalModulesInput) {
  const heading = useId();
  const shell = (content: React.ReactNode) => <section className="optional-modules" dir="rtl" lang="ar" aria-labelledby={heading}>
    <h2 id={heading}>وحدات الخطة الحالية</h2>{content}
  </section>;
  if (read.state !== 'ready') return shell(<p role={read.state === 'error' ? 'alert' : 'status'}>
    {read.state === 'loading' ? 'جارٍ تحميل حالة الوحدات…' : read.state === 'error' ? 'تعذر تحميل الوحدات. أعد المحاولة من صفحة الاشتراك.' : 'حالة الوحدات غير متاحة حاليًا.'}
  </p>);
  const { authorization, snapshot } = read;
  if (read.companyId !== companyId || read.userId !== userId || authorization.user.id !== userId
    || authorization.selectedCompany?.id !== companyId || snapshot.company.id !== companyId) {
    return shell(<p role="status">تغير سياق الحساب أو الشركة. يلزم تحديث البيانات.</p>);
  }
  if (!authorization.permissions.includes('subscriptions.view')) {
    return shell(<p>عرض الوحدات يحتاج صلاحية الاطلاع على الاشتراك.</p>);
  }
  const plan = snapshot.current.plan;
  const byId = new Map(plan.modules.map(module => [module.id, module]));
  const effective = new Map(snapshot.effectiveModules.map(module => [module.id, module]));
  // Preserve grandfathered/add-on entitlements absent from this version's catalogue.
  const rows = [...plan.modules, ...snapshot.effectiveModules.filter(module => !byId.has(module.id))];
  const sourceText = { PLAN: 'الخطة', ADD_ON: 'إضافة', GRANDFATHERED: 'استحقاق محفوظ سابقًا' } as const;
  const policyText = {
    DISABLED: 'التغيير الذاتي غير متاح لهذه النسخة؛ راجع مسؤول المنصة.',
    REQUEST_ONLY: 'تغيير الوحدات يمر بطلب ومراجعة؛ إرسال الطلب لا يعني التفعيل.',
    IMMEDIATE_FREE: 'تطبق رحلة الاشتراك شروط التغيير المجاني؛ لا يمنح هذا العرض أي وحدة.',
  } as const;
  return shell(<>
    <p>يعرض هذا القسم وحدات نسخة الخطة الحالية والاستحقاقات المسجلة للشركة. الوحدات الأخرى تُراجع في كتالوج الخطط داخل صفحة الاشتراك.</p>
    <p>الاستحقاق التجاري منفصل عن صلاحيات المستخدم وضوابط تشغيل كل وظيفة؛ القرار النهائي للخادم.</p>
    <p>{policyText[plan.selfServicePolicy]}</p>
    {!authorization.permissions.includes('subscriptions.manage') && <p>لتغيير الوحدات، تواصل مع مسؤول يملك صلاحية إدارة الاشتراك.</p>}
    {snapshot.pending && <p>يوجد طلب قيد المراجعة؛ وحداته ليست استحقاقات نافذة بسبب الطلب.</p>}
    {snapshot.scheduled && <p>يوجد تغيير مجدول؛ لا يستبدل الحالة الحالية قبل نفاذه وتحديثها من الخادم.</p>}
    {rows.length === 0 ? <p>لا توجد وحدات في البيانات المستلمة؛ لا يعني ذلك حذف بيانات الشركة.</p> : <ul className="optional-modules__list">
      {rows.map(module => {
        const definition = byId.get(module.id);
        const entitlement = effective.get(module.id);
        const inAuthorization = authorization.modules.some(code => code === module.code);
        const hasPermission = authorization.permissions.some(permission => permissionModule(permission) === module.code);
        return <li key={module.id} className="optional-modules__card">
          <h3>{module.displayName}</h3>
          <p><b>نوع الإدراج: </b>{definition ? definition.selectionMode === 'OPTIONAL' ? 'اختيارية ضمن هذه النسخة' : 'مشمولة ضمن هذه النسخة' : 'استحقاق خارج قائمة هذه النسخة'}</p>
          <p><b>الاستحقاق الحالي: </b>{entitlement ? `مسجل للشركة — المصدر: ${sourceText[entitlement.source]}` : 'غير مسجل ضمن الاستحقاقات الحالية'}</p>
          <p><b>الإتاحة في الكتالوج: </b>{definition ? definition.active ? 'نشطة في نسخة الخطة' : 'غير نشطة في نسخة الخطة' : 'لا تتوفر تفاصيل الإتاحة في هذه النسخة'}</p>
          <p><b>لقطة الصلاحيات: </b>{inAuthorization
            ? hasPermission ? 'الوحدة موجودة ولديك صلاحيات مرتبطة بها؛ تخضع كل عملية لضوابطها.' : 'الوحدة موجودة دون صلاحية مستخدم مرتبطة بها في اللقطة الحالية.'
            : 'الوحدة غير موجودة في لقطة الصلاحيات الحالية؛ لا يمكن تأكيد استخدامها.'}</p>
          <div><b>المتطلبات: </b>{!definition ? 'تفاصيل الاعتماديات غير متاحة.' : definition.dependencyIds.length === 0 ? 'لا توجد اعتماديات معلنة في هذه النسخة.' : <ul>
            {definition.dependencyIds.map(id => {
              const dependency = byId.get(id);
              return <li key={id}>{dependency?.displayName ?? 'وحدة غير معرّفة في هذه النسخة'} — {dependency ? !dependency.active ? 'غير نشطة في الكتالوج' : effective.has(id) ? 'استحقاق مسجل؛ تحقق التشغيل من الخادم' : 'استحقاق غير مسجل حاليًا' : 'يلزم التحقق لدى مسؤول الاشتراك'}</li>;
            })}
          </ul>}</div>
          {definition?.selectionMode === 'OPTIONAL' && <p><b>الرسم الدوري الإضافي في النسخة: </b>{definition.additionalRecurringFee === null ? 'غير محدد؛ لا يعني أنه مجاني' : <><bdi>{definition.additionalRecurringFee} {plan.currencyCode}</bdi> — {({ MONTHLY: 'شهري', QUARTERLY: 'ربع سنوي', ANNUAL: 'سنوي' } as const)[plan.billingCycle]}؛ الإجمالي والضرائب في مراجعة الاشتراك</>}</p>}
        </li>;
      })}
    </ul>}
    <p>أي تغيير يتم عبر رحلة مراجعة الاشتراك الحالية. لا يحذف هذا العرض بيانات ولا يغير استحقاقات.</p>
  </>);
}
