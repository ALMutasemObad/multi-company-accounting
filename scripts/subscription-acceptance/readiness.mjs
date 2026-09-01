import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Playwright first waits for readiness printed by each child it launched. An
// existing listener cannot satisfy stdout readiness, and strict binding fails.
export default async function readiness() {
  const output = process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR;
  if (!output) throw new Error('Missing subscription evidence directory');
  const api = await fetch('http://127.0.0.1:3166/api/v1/auth/csrf', { signal: AbortSignal.timeout(5_000) });
  if (api.status !== 200 || typeof (await api.json()).csrfToken !== 'string') throw new Error('Subscription fixture is not ready');
  const web = await fetch('http://127.0.0.1:4216/', { signal: AbortSignal.timeout(5_000) });
  if (web.status !== 200 || !(await web.text()).includes('id="root"')) throw new Error('Subscription web app is not ready');
  writeFileSync(resolve(output, 'readiness.json'), `${JSON.stringify({
    checkedAt: new Date().toISOString(), fixtureStatus: 200, webStatus: 200, ownedStdoutReadiness: true,
  }, null, 2)}\n`);
}
