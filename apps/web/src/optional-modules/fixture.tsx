import { I18nProvider, loadLocale, resolveLocale, useI18n } from '../i18n';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/700.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/700.css';
import { OptionalModulesCatalog, type OptionalModulesInput } from './OptionalModulesCatalog';
import { fixtureInput } from './fixture-data';

function Fixture() {
  const { t, dir, locale } = useI18n();
  const [scenario, setScenario] = useState('ready');
  const ready = fixtureInput();
  let read: OptionalModulesInput['read'] = ready;
  if (scenario === 'loading' || scenario === 'error' || scenario === 'unavailable') read = { state: scenario };
  if (scenario === 'foreign') ready.snapshot.company.id = '43';
  if (scenario === 'forbidden') ready.authorization.permissions = [];
  if (scenario === 'pending') { ready.snapshot.pending = { ...ready.snapshot.current, state: 'PENDING_APPROVAL' }; ready.snapshot.scheduled = { ...ready.snapshot.current }; }
  return <main>
    <div className="optional-modules optional-modules-fixture-controls" dir={dir} lang={locale}>
      <h2>{t('optionalModules.heading')}</h2>
      <label>{t('subscription.status')} <select style={{ font: 'inherit' }} value={scenario} onChange={event => setScenario(event.target.value)}>
        <option value="ready">{t('subscription.currentPlan')}</option><option value="pending">{t('optionalModules.pending')}</option><option value="loading">{t('subscription.loading')}</option><option value="error">{t('optionalModules.error')}</option><option value="unavailable">{t('optionalModules.unavailable')}</option><option value="foreign">{t('optionalModules.contextChanged')}</option><option value="forbidden">{t('optionalModules.viewRequired')}</option>
      </select></label>
    </div>
    <OptionalModulesCatalog companyId="42" userId="7" read={read} />
  </main>;
}
const fixtureLocale = resolveLocale(new URLSearchParams(location.search).get('locale'));
await Promise.all([loadLocale('ar'), loadLocale(fixtureLocale)]);
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale={fixtureLocale}><Fixture /></I18nProvider>);
