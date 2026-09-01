const key = item => `${item.file}\n${item.title}\n${item.project}`;

// Deliberately uses a checked-in matrix, never the current collection as its own
// expectation. Collection success is distinct from execution acceptance.
export function verifySubscriptionReport(expected, report) {
  const issues = [];
  const wanted = expected.cases.map(item => key({ ...item, project: expected.project }));
  if (expected.expectedCount !== 58 || wanted.length !== 58 || new Set(wanted).size !== 58) issues.push('Invalid fixed 58-case manifest');
  if (!['run', 'list'].includes(report.mode)) issues.push('Unknown acceptance mode');
  if (report.status !== 'passed' || report.errors.length) issues.push('Runner failed, timed out, was interrupted or reported a global error');
  if (report.forbidOnly !== true || report.workers !== 1 || report.projects.length !== 1 || report.projects[0]?.name !== expected.project
    || report.projects[0]?.retries !== 0 || report.projects[0]?.repeatEach !== 1) issues.push('Expected one project, one worker and no repeat/retry');
  const seen = report.cases.map(key);
  if (seen.length !== 58 || new Set(seen).size !== 58) issues.push('Expected 58 distinct file/title/project identities');
  const wantedSet = new Set(wanted);
  for (const identity of seen) if (!wantedSet.has(identity)) issues.push(`Unexpected case: ${identity.replaceAll('\n', ' / ')}`);
  const seenSet = new Set(seen);
  for (const identity of wanted) if (!seenSet.has(identity)) issues.push(`Missing case: ${identity.replaceAll('\n', ' / ')}`);
  for (const item of report.cases) {
    if (item.expectedStatus !== 'passed' || item.retries !== 0 || item.repeatEachIndex !== 0
      || item.annotations.some(annotation => ['skip', 'fixme'].includes(annotation.type))) issues.push(`Not an unconditional first attempt: ${item.file} / ${item.title}`);
    if (report.mode === 'run' && (item.results.length !== 1 || item.results[0]?.status !== 'passed' || item.results[0]?.retry !== 0)) {
      issues.push(`Expected exactly one passed result: ${item.file} / ${item.title}`);
    }
    if (report.mode === 'list' && item.results.length) issues.push('Collection must not claim executed results');
  }
  return issues;
}
