import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError } from '@playwright/test/reporter';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { verifySubscriptionReport } from './verify-report.mjs';

export default class SubscriptionAcceptanceReporter implements Reporter {
  private config?: FullConfig;
  private tests: TestCase[] = [];
  private errors: string[] = [];
  onBegin(config: FullConfig, suite: Suite) { this.config = config; this.tests = suite.allTests(); }
  onError(error: TestError) { this.errors.push(error.message ?? 'Unknown runner error'); }
  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> {
    const report = {
      mode: process.env.SUBSCRIPTION_ACCEPTANCE_MODE, status: result.status,
      workers: this.config?.workers, forbidOnly: this.config?.forbidOnly, errors: this.errors,
      projects: this.config?.projects.map(project => ({ name: project.name, retries: project.retries, repeatEach: project.repeatEach })) ?? [],
      cases: this.tests.map(test => ({
        file: relative(resolve('tests/subscription-discovery'), test.location.file).replaceAll('\\', '/'),
        title: test.title, project: test.parent.project()?.name ?? '', expectedStatus: test.expectedStatus,
        retries: test.retries, repeatEachIndex: test.repeatEachIndex,
        annotations: test.annotations, results: test.results.map(item => ({ status: item.status, retry: item.retry })),
      })),
    };
    try {
      const expected = JSON.parse(readFileSync(resolve('scripts/subscription-acceptance/expected-cases.json'), 'utf8'));
      const issues = verifySubscriptionReport(expected, report);
      const output = process.env.SUBSCRIPTION_ACCEPTANCE_RUN_DIR;
      if (!output) throw new Error('Missing fresh acceptance output directory');
      writeFileSync(resolve(output, 'gate-report.json'), `${JSON.stringify({
        accepted: issues.length === 0 && report.mode === 'run', collectionValid: issues.length === 0 && report.mode === 'list',
        issues, ...report,
      }, null, 2)}\n`);
      if (issues.length) console.error(`Subscription acceptance rejected:\n${issues.join('\n')}`);
      return { status: issues.length ? 'failed' : result.status };
    } catch (cause) {
      console.error('Subscription acceptance report could not be verified or saved:', cause);
      return { status: 'failed' };
    }
  }
}
