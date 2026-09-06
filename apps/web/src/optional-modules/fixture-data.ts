import { upgradeSnapshot } from '../subscription-upgrade-test-fixtures';
import type { OptionalModulesInput } from './OptionalModulesCatalog';

/** Synthetic only: never import into application routes or production loaders. */
export function fixtureInput(): Extract<OptionalModulesInput['read'], { state: 'ready' }> {
  const snapshot = upgradeSnapshot();
  snapshot.current.plan.displayName = 'خطة تجريبية محلية';
  snapshot.current.plan.modules = [
    { id: '1', code: 'CORE_ACCOUNTING', displayName: 'المحاسبة الأساسية', active: true, selectionMode: 'INCLUDED', dependencyIds: [], additionalRecurringFee: null },
    { id: '2', code: 'SALES', displayName: 'المبيعات', active: true, selectionMode: 'OPTIONAL', dependencyIds: ['1'], additionalRecurringFee: '0.0000' },
    { id: '3', code: 'POS', displayName: 'نقاط البيع', active: true, selectionMode: 'OPTIONAL', dependencyIds: ['2', '4'], additionalRecurringFee: '25.0000' },
    { id: '4', code: 'TREASURY', displayName: 'الخزينة', active: true, selectionMode: 'OPTIONAL', dependencyIds: ['1'], additionalRecurringFee: null },
    { id: '5', code: 'CRM', displayName: 'وحدة غير نشطة للتوضيح', active: false, selectionMode: 'OPTIONAL', dependencyIds: ['2'], additionalRecurringFee: null },
  ];
  snapshot.effectiveModules = [
    { id: '1', code: 'CORE_ACCOUNTING', displayName: 'المحاسبة الأساسية', source: 'PLAN' },
    { id: '2', code: 'SALES', displayName: 'المبيعات', source: 'ADD_ON' },
    { id: '6', code: 'REPORTING', displayName: 'التقارير', source: 'GRANDFATHERED' },
  ];
  return { state: 'ready', companyId: '42', userId: '7', snapshot,
    authorization: { user: { id: '7', displayName: 'مستخدم تجريبي' }, selectedCompany: { id: '42', name: 'شركة تجريبية', timezone: 'Asia/Riyadh' },
      modules: ['CORE_ACCOUNTING', 'SALES', 'REPORTING'], permissions: ['subscriptions.view', 'subscriptions.manage', 'accounts.view', 'crm.view'] } };
}
