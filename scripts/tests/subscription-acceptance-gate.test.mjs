import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifySubscriptionReport } from '../subscription-acceptance/verify-report.mjs';

const expected = JSON.parse(readFileSync(new URL('../subscription-acceptance/expected-cases.json', import.meta.url), 'utf8'));
const complete = () => ({
  mode: 'run', status: 'passed', workers: 1, forbidOnly: true, errors: [],
  projects: [{ name: expected.project, retries: 0, repeatEach: 1 }],
  cases: expected.cases.map(item => ({ ...item, project: expected.project,
    expectedStatus: 'passed', retries: 0, repeatEachIndex: 0, annotations: [],
    results: [{ status: 'passed', retry: 0 }],
  })),
});

test('fixed published matrix has six specs and precisely 58 unique names', () => {
  assert.equal(expected.cases.length, 58);
  assert.equal(new Set(expected.cases.map(item => `${item.file}\n${item.title}`)).size, 58);
  const counts = {};
  for (const item of expected.cases) counts[item.file] = (counts[item.file] ?? 0) + 1;
  assert.deepEqual(counts, {
    'plan-navigation.spec.ts': 10, 'wave1/acceptance.spec.ts': 13,
    'wave1/d3-context.spec.ts': 14, 'wave1/defects.spec.ts': 3,
    'wave1/qa-fixes.spec.ts': 12, 'wave1/visual-fixes.spec.ts': 6,
  });
});

test('accepts only a full first-attempt pass; order is immaterial', () => {
  const report = complete();
  report.cases.reverse();
  assert.deepEqual(verifySubscriptionReport(expected, report), []);
});

const invalidRuns = [
  ['filtered collection', report => { report.cases.pop(); }],
  ['duplicate replacing a missing identity', report => { report.cases[1] = structuredClone(report.cases[0]); }],
  ['extra duplicate result identity', report => { report.cases.push(structuredClone(report.cases[0])); }],
  ['renamed case at the same count', report => { report.cases[0].title = 'unreviewed replacement'; }],
  ['wrong file at the same count', report => { report.cases[0].file = 'another.spec.ts'; }],
  ['58 divided between two projects', report => {
    report.projects.push({ name: 'other', retries: 0, repeatEach: 1 });
    for (const item of report.cases.slice(29)) item.project = 'other';
  }],
  ['skipped case', report => { report.cases[0].results[0].status = 'skipped'; }],
  ['skip annotation despite a passed result', report => { report.cases[0].annotations.push({ type: 'skip' }); }],
  ['fixme annotation', report => { report.cases[0].annotations.push({ type: 'fixme' }); }],
  ['expected failure', report => { report.cases[0].expectedStatus = 'failed'; report.cases[0].results[0].status = 'failed'; }],
  ['expected failure unexpectedly passing', report => { report.cases[0].expectedStatus = 'failed'; }],
  ['unfinished case after early termination', report => { report.cases[0].results = []; }],
  ['test timeout', report => { report.cases[0].results[0].status = 'timedOut'; }],
  ['global timeout despite all pass records', report => { report.status = 'timedout'; }],
  ['interrupted run', report => { report.status = 'interrupted'; }],
  ['global error despite pass records', report => { report.errors.push('webServer exited unexpectedly'); }],
  ['flaky retry', report => { report.cases[0].results = [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }]; }],
  ['only the retried pass retained', report => { report.cases[0].results[0].retry = 1; }],
  ['configured per-test retry', report => { report.cases[0].retries = 1; }],
  ['repeated case', report => { report.cases[0].repeatEachIndex = 1; }],
  ['configured project retry', report => { report.projects[0].retries = 1; }],
  ['configured project repeat', report => { report.projects[0].repeatEach = 2; }],
  ['multiple workers', report => { report.workers = 2; }],
  ['disabled forbidOnly', report => { report.forbidOnly = false; }],
  ['unknown mode', report => { report.mode = 'partial'; }],
];
for (const [name, mutate] of invalidRuns) {
  test(`rejects ${name}`, () => {
    const report = complete();
    mutate(report);
    assert.notEqual(verifySubscriptionReport(expected, report).length, 0);
  });
}

test('collection is checked separately and cannot substitute for execution', () => {
  const report = complete();
  report.mode = 'list';
  for (const item of report.cases) item.results = [];
  assert.deepEqual(verifySubscriptionReport(expected, report), []);
  report.mode = 'run';
  assert.notEqual(verifySubscriptionReport(expected, report).length, 0);
  report.mode = 'list';
  report.cases[0].results.push({ status: 'passed', retry: 0 });
  assert.notEqual(verifySubscriptionReport(expected, report).length, 0);
});
