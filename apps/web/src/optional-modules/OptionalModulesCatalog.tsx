import React, { useId } from 'react';
import { permissionModule } from '../module-entitlements';
import { useI18n } from '../i18n';
import type { arOptionalModules } from '../i18n/locales/optional-modules';
type ModuleTextKey = keyof typeof arOptionalModules extends `optionalModules.${infer K}` ? K : never;
import type { CurrentAuthorization, SubscriptionSnapshot } from '../types';
import './optional-modules.css';

/** Captured by the loader; invalidated before refresh and on authorization changes. */
export type OptionalModulesInput = {
  companyId: string;
  userId: string;
  read: { state: 'loading' | 'error' | 'unavailable' } | {
    state: 'ready'; companyId: string; userId: string;
    authorization: CurrentAuthorization; snapshot: SubscriptionSnapshot;
  };
};

export function OptionalModulesCatalog({ companyId, userId, read }: OptionalModulesInput) {
  const heading = useId();
  const { t, dir, locale } = useI18n();
  const text = (key: ModuleTextKey) => t(`optionalModules.${key}`);
  const shell = (content: React.ReactNode) => <section className="optional-modules" dir={dir} lang={locale} aria-labelledby={heading}>
    <h2 id={heading}>{text('heading')}</h2>{content}
  </section>;
  if (read.state !== 'ready') return shell(<p role={read.state === 'error' ? 'alert' : 'status'}>{text(read.state)}</p>);
  const { authorization, snapshot } = read;
  if (read.companyId !== companyId || read.userId !== userId || authorization.user.id !== userId
    || authorization.selectedCompany?.id !== companyId || snapshot.company.id !== companyId) {
    return shell(<p role="status">{text('contextChanged')}</p>);
  }
  if (!authorization.permissions.includes('subscriptions.view')) return shell(<p>{text('viewRequired')}</p>);
  const plan = snapshot.current.plan;
  const byId = new Map(plan.modules.map(module => [module.id, module]));
  const effective = new Map(snapshot.effectiveModules.map(module => [module.id, module]));
  const rows = [...plan.modules, ...snapshot.effectiveModules.filter(module => !byId.has(module.id))];
  return shell(<>
    <p>{text('description')}</p><p>{text('serverDecision')}</p>
    <p>{text(`policy.${plan.selfServicePolicy}`)}</p>
    {!authorization.permissions.includes('subscriptions.manage') && <p>{text('manageRequired')}</p>}
    {snapshot.pending && <p>{text('pending')}</p>}
    {snapshot.scheduled && <p>{text('scheduled')}</p>}
    {rows.length === 0 ? <p>{text('empty')}</p> : <ul className="optional-modules__list">
      {rows.map(module => {
        const definition = byId.get(module.id);
        const entitlement = effective.get(module.id);
        const inAuthorization = authorization.modules.some(code => code === module.code);
        const hasPermission = authorization.permissions.some(permission => permissionModule(permission) === module.code);
        return <li key={module.id} className="optional-modules__card">
          <h3>{module.displayName}</h3>
          <p><b>{text('inclusionLabel')} </b>{text(definition ? definition.selectionMode === 'OPTIONAL' ? 'optional' : 'included' : 'outside')}</p>
          <p><b>{text('entitlementLabel')} </b>{entitlement ? <>{text('registered')} {text(`source.${entitlement.source}`)}</> : text('notRegistered')}</p>
          <p><b>{text('availabilityLabel')} </b>{text(definition ? definition.active ? 'active' : 'inactive' : 'availabilityUnknown')}</p>
          <p><b>{text('authorizationLabel')} </b>{text(inAuthorization ? hasPermission ? 'withPermission' : 'withoutPermission' : 'withoutModule')}</p>
          <div><b>{text('requirementsLabel')} </b>{!definition ? text('dependenciesUnknown') : definition.dependencyIds.length === 0 ? text('noDependencies') : <ul>
            {definition.dependencyIds.map(id => {
              const dependency = byId.get(id);
              return <li key={id}>{dependency?.displayName ?? text('unknownModule')} — {text(dependency ? !dependency.active ? 'dependencyInactive' : effective.has(id) ? 'dependencyRegistered' : 'dependencyMissing' : 'askAdministrator')}</li>;
            })}
          </ul>}</div>
          {definition?.selectionMode === 'OPTIONAL' && <p><b>{text('feeLabel')} </b>{definition.additionalRecurringFee === null ? text('unpriced') : <><bdi>{definition.additionalRecurringFee} {plan.currencyCode}</bdi> — {t(`subscription.cycle.${plan.billingCycle}`)}{text('reviewTotals')}</>}</p>}
        </li>;
      })}
    </ul>}
    <p>{text('footer')}</p>
  </>);
}
