// Local acceptance fixtures only. No database, outbound calls, or business mutations.
import { createServer } from 'node:http';
import { responseFor } from '../../../scripts/visual-qa-server.mjs';

const scenarios = ['owner', 'anonymous', 'employee', 'viewer', 'no-company', 'empty', 'error', 'limited'];
let scenario = 'owner';
let selectedCompanyId = '1';
let requests = [];
const fixture = path => structuredClone(responseFor(new URL(`http://127.0.0.1/api/v1${path}`), 'GET'));
const company = fixture('/auth/companies').data[0];
const companies = [{ ...company, id: '1', name: 'QA Company A' }, { ...company, id: '2', name: 'QA Company B' }];
const send = (res, status, body, contentType = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body === undefined ? undefined : contentType.startsWith('application/json') ? JSON.stringify(body) : body);
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:3166');
  if (url.pathname === '/__qa') {
    return send(res, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>W1 local fixtures</title><style>body{font:18px sans-serif;max-width:850px;margin:40px auto}h1{font-size:24px}button,a{font:inherit;margin:8px;padding:10px}</style><h1>Local subscription acceptance fixtures</h1><p>No database, mail, payment, or production session. Scenario: <strong>${scenario}</strong></p><form action="/__qa/scenario" method="get">${scenarios.map(value => `<button name="name" value="${value}">${value}</button>`).join('')}</form><p><a href="http://127.0.0.1:4216/plans">Open public plans</a><a href="http://127.0.0.1:4216/#home">Open app home</a></p><pre>${JSON.stringify(requests, null, 2)}</pre></html>`, 'text/html; charset=utf-8');
  }
  if (url.pathname === '/__qa/scenario' && scenarios.includes(url.searchParams.get('name'))) {
    scenario = url.searchParams.get('name'); selectedCompanyId = '1'; requests = [];
    res.writeHead(303, { Location: '/__qa', 'Cache-Control': 'no-store' }); return res.end();
  }
  if (!url.pathname.startsWith('/api/v1/')) return send(res, 404, { code: 'QA_ROUTE_NOT_FOUND' });
  const path = url.pathname.slice('/api/v1'.length);
  requests.push({ method: req.method, path: path + url.search, scenario, companyId: selectedCompanyId });
  if (requests.length > 200) requests.shift();
  if (req.method !== 'GET') {
    if (path === '/auth/logout') { scenario = 'anonymous'; return send(res, 204); }
    if (path === '/auth/login') {
      scenario = 'owner'; return send(res, 200, { user: fixture('/auth/me').user, csrfToken: 'visual-qa-csrf' });
    }
    if (path === '/auth/context' && req.method === 'PUT') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return send(res, 413, { code: 'QA_BODY_LIMIT' }); }
      const next = JSON.parse(body).companyId;
      if (!companies.some(item => item.id === next)) return send(res, 404, { code: 'QA_COMPANY_NOT_FOUND' });
      selectedCompanyId = next; if (scenario === 'no-company') scenario = 'owner'; return send(res, 204);
    }
    return send(res, 409, { code: 'QA_BUSINESS_WRITES_DISABLED' });
  }
  if (scenario === 'anonymous' && ['/auth/me', '/auth/companies'].includes(path)) return send(res, 401, { code: 'AUTHENTICATION_REQUIRED' });
  if (path === '/platform/capabilities') return send(res, 200, { platformOperations: false });
  if (path === '/auth/companies') return send(res, 200, { data: companies });
  if (path === '/auth/me') {
    const auth = fixture(path);
    auth.selectedCompany = scenario === 'no-company' ? null : { ...auth.selectedCompany, id: selectedCompanyId, name: companies.find(item => item.id === selectedCompanyId).name };
    if (scenario === 'employee') auth.permissions = auth.permissions.filter(value => !value.startsWith('subscriptions.'));
    if (scenario === 'viewer') auth.permissions = auth.permissions.filter(value => value !== 'subscriptions.manage');
    return send(res, 200, auth);
  }
  if (['/public/subscription-plans', '/subscription/catalog'].includes(path)) {
    if (scenario === 'error') return send(res, 503, { code: 'UNAVAILABLE' });
    const data = fixture(path);
    if (scenario === 'empty') { data.plans = []; data.meta.total = 0; data.meta.totalPages = 0; }
    if (scenario === 'limited') { data.plans = data.plans.slice(0, 1); data.meta.total = data.meta.pageSize + 1; data.meta.totalPages = 2; data.meta.page = Number(url.searchParams.get('page') ?? '1'); }
    return send(res, 200, data);
  }
  const data = structuredClone(responseFor(url, 'GET'));
  if (path === '/subscription') data.current.plan.displayName = `QA Company ${selectedCompanyId === '1' ? 'A' : 'B'} Plan`;
  if (path === '/subscription/usage') data.companyId = selectedCompanyId;
  return send(res, data === null ? 204 : 200, data === null ? undefined : data);
});
server.listen(3166, '127.0.0.1', () => console.log('W1 fixture API http://127.0.0.1:3166; controls /__qa; no DB or business writes'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
