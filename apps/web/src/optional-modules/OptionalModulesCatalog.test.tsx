import { I18nProvider, loadLocale } from '../i18n';
await loadLocale('ar');
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OptionalModulesCatalog, type OptionalModulesInput } from './OptionalModulesCatalog';
import { fixtureInput } from './fixture-data';

const render = (read: OptionalModulesInput['read'], companyId = '42', userId = '7') => renderToStaticMarkup(<I18nProvider initialLocale="ar"><OptionalModulesCatalog companyId={companyId} userId={userId} read={read} /></I18nProvider>);
describe('current-plan optional module catalogue', () => {
  it('shows entitlement, catalogue state, requirements and exact decimal strings without an activation control', () => {
    const html = render(fixtureInput());
    expect(html).toContain('اختيارية ضمن هذه النسخة');
    expect(html).toContain('مشمولة ضمن هذه النسخة');
    expect(html).toContain('المصدر: إضافة');
    expect(html).toContain('25.0000 SAR');
    expect(html).toContain('0.0000 SAR');
    expect(html).toContain('غير محدد؛ لا يعني أنه مجاني');
    expect(html).toContain('استحقاق غير مسجل حاليًا');
    expect(html).toContain('غير نشطة في نسخة الخطة');
    expect(html).not.toMatch(/<button|<input|<a |<form|undefined|NaN/u);
  });
  it.each(['loading', 'error', 'unavailable'] as const)('does not turn %s into an absent entitlement', state => {
    const html = render({ state });
    expect(html).not.toContain('Sales');
    expect(html).not.toContain('غير مسجل');
  });
  it.each(['scope-company', 'scope-user', 'auth-company', 'auth-user', 'snapshot-company', 'no-company'] as const)('hides private content on %s mismatch', scenario => {
    const read = fixtureInput();
    if (scenario === 'scope-company') read.companyId = '43';
    if (scenario === 'scope-user') read.userId = '8';
    if (scenario === 'auth-company') read.authorization.selectedCompany!.id = '43';
    if (scenario === 'auth-user') read.authorization.user.id = '8';
    if (scenario === 'snapshot-company') read.snapshot.company.id = '43';
    if (scenario === 'no-company') read.authorization.selectedCompany = null;
    expect(render(read)).toContain('تغير سياق');
    expect(render(read)).not.toContain('Sales');
  });
  it('hides names and fees without view permission and explains manage permission separately', () => {
    const read = fixtureInput(); read.authorization.permissions = ['subscriptions.manage'];
    expect(render(read)).not.toContain('25.0000'); expect(render(read)).not.toContain('Sales');
    read.authorization.permissions = ['subscriptions.view'];
    expect(render(read)).toContain('تواصل مع مسؤول');
    expect(render(read)).toContain('دون صلاحية مستخدم مرتبطة');
  });
  it('reuses the existing CRM to SALES permission mapping without declaring CRM enabled', () => {
    const html = render(fixtureInput());
    expect(html).toContain('ولديك صلاحيات مرتبطة بها');
    expect(html).toContain('الوحدة غير موجودة في لقطة الصلاحيات الحالية');
  });
  it('does not promote pending or scheduled modules to effective entitlements', () => {
    const read = fixtureInput();
    read.snapshot.pending = { ...read.snapshot.current, state: 'PENDING_APPROVAL', modules: [{ id: '3', code: 'POS', displayName: 'Point of sale', selectionMode: 'OPTIONAL' }] };
    read.snapshot.scheduled = { ...read.snapshot.pending, state: 'APPROVED' };
    const html = render(read);
    expect(html).toContain('يوجد طلب قيد المراجعة'); expect(html).toContain('يوجد تغيير مجدول');
    const pos = html.split('<h3>Point of sale</h3>')[1]!.split('</li>')[0]!;
    expect(pos).toContain('غير مسجل ضمن الاستحقاقات الحالية');
  });
  it('preserves grandfathered records absent from the plan and does not invent metadata', () => {
    const html = render(fixtureInput());
    expect(html).toContain('استحقاق محفوظ سابقًا');
    expect(html).toContain('استحقاق خارج قائمة هذه النسخة');
    expect(html).toContain('تفاصيل الاعتماديات غير متاحة');
  });
  it('shows unknown or inactive dependencies without resolving them locally', () => {
    const read = fixtureInput(); read.snapshot.current.plan.modules[2]!.dependencyIds = ['5', '999'];
    const html = render(read);
    expect(html).toContain('غير نشطة في الكتالوج'); expect(html).toContain('وحدة غير معرّفة');
  });
  it.each(['DISABLED', 'REQUEST_ONLY', 'IMMEDIATE_FREE'] as const)('never activates via %s policy', policy => {
    const read = fixtureInput(); read.snapshot.current.plan.selfServicePolicy = policy;
    expect(render(read)).not.toContain('<button');
  });
  it('does not infer capability changes from subscription lifecycle status', () => {
    const read = fixtureInput(); const active = render(read);
    read.snapshot.subscription.status = 'SUSPENDED';
    expect(render(read)).toBe(active);
  });
  it('escapes names, uses RTL and unique accessible headings', () => {
    const read = fixtureInput(); read.snapshot.current.plan.modules[0]!.displayName = '<script>unsafe</script>';
    const html = renderToStaticMarkup(<I18nProvider initialLocale="ar"><OptionalModulesCatalog companyId="42" userId="7" read={read} /><OptionalModulesCatalog companyId="42" userId="7" read={read} /></I18nProvider>);
    expect(html).toContain('dir="rtl" lang="ar"'); expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const ids = [...html.matchAll(/ id="([^"]+)"/gu)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('explains empty data without claiming deletion', () => {
    const read = fixtureInput(); read.snapshot.current.plan.modules = []; read.snapshot.effectiveModules = [];
    expect(render(read)).toContain('لا يعني ذلك حذف بيانات الشركة');
  });
});
