import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/700.css';
import { OptionalModulesCatalog, type OptionalModulesInput } from './OptionalModulesCatalog';
import { fixtureInput } from './fixture-data';

function Fixture() {
  const [scenario, setScenario] = useState('ready');
  const ready = fixtureInput();
  let read: OptionalModulesInput['read'] = ready;
  if (scenario === 'loading' || scenario === 'error' || scenario === 'unavailable') read = { state: scenario };
  if (scenario === 'foreign') ready.snapshot.company.id = '43';
  if (scenario === 'forbidden') ready.authorization.permissions = [];
  if (scenario === 'pending') { ready.snapshot.pending = { ...ready.snapshot.current, state: 'PENDING_APPROVAL' }; ready.snapshot.scheduled = { ...ready.snapshot.current }; }
  return <main>
    <div className="optional-modules" dir="rtl" lang="ar">
      <h2>معاينة محلية ببيانات محاكاة</h2>
      <label>حالة العرض <select style={{ font: 'inherit' }} value={scenario} onChange={event => setScenario(event.target.value)}>
        <option value="ready">الحالة الحالية</option><option value="pending">طلب معلق وتغيير مجدول</option><option value="loading">تحميل</option><option value="error">فشل القراءة</option><option value="unavailable">غير متاحة</option><option value="foreign">شركة مختلفة</option><option value="forbidden">دون صلاحية العرض</option>
      </select></label>
    </div>
    <OptionalModulesCatalog companyId="42" userId="7" read={read} />
  </main>;
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Fixture />);
