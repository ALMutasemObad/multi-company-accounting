import { logEvent } from './logger.js';

type Labels = Record<string, string>;

function escapeLabel(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function metricKey(labelNames: readonly string[], labels: Labels) {
  return labelNames.map((name) => labels[name] ?? '').join('\u0000');
}

function renderLabels(labelNames: readonly string[], labels: Labels, extra: Labels = {}) {
  const entries = [...labelNames.map((name) => [name, labels[name] ?? ''] as const), ...Object.entries(extra)];
  if (!entries.length) return '';
  return `{${entries.map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(',')}}`;
}

abstract class MetricFamily {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
  ) {}

  protected header(type: 'counter' | 'gauge' | 'histogram') {
    return [`# HELP ${this.name} ${this.help.replaceAll('\n', ' ')}`, `# TYPE ${this.name} ${type}`];
  }

  abstract render(): string[];
}

export class Counter extends MetricFamily {
  private readonly series = new Map<string, { labels: Labels; value: number }>();

  increment(labels: Labels = {}, value = 1) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Counter increments must be finite and non-negative');
    const key = metricKey(this.labelNames, labels);
    const current = this.series.get(key);
    if (current) current.value += value;
    else this.series.set(key, { labels: { ...labels }, value });
  }

  value(labels: Labels = {}) {
    return this.series.get(metricKey(this.labelNames, labels))?.value ?? 0;
  }

  render() {
    const lines = this.header('counter');
    for (const { labels, value } of [...this.series.values()].sort((left, right) => metricKey(this.labelNames, left.labels).localeCompare(metricKey(this.labelNames, right.labels)))) {
      lines.push(`${this.name}${renderLabels(this.labelNames, labels)} ${value}`);
    }
    return lines;
  }
}

export class Gauge extends MetricFamily {
  private readonly series = new Map<string, { labels: Labels; value: number }>();

  set(labels: Labels = {}, value: number) {
    if (!Number.isFinite(value)) throw new Error('Gauge values must be finite');
    this.series.set(metricKey(this.labelNames, labels), { labels: { ...labels }, value });
  }

  value(labels: Labels = {}) {
    return this.series.get(metricKey(this.labelNames, labels))?.value ?? 0;
  }

  render() {
    const lines = this.header('gauge');
    for (const { labels, value } of [...this.series.values()].sort((left, right) => metricKey(this.labelNames, left.labels).localeCompare(metricKey(this.labelNames, right.labels)))) {
      lines.push(`${this.name}${renderLabels(this.labelNames, labels)} ${value}`);
    }
    return lines;
  }
}

export class Histogram extends MetricFamily {
  private readonly series = new Map<string, { labels: Labels; count: number; sum: number; buckets: number[] }>();

  constructor(name: string, help: string, labelNames: readonly string[], private readonly boundaries: readonly number[]) {
    super(name, help, labelNames);
  }

  observe(labels: Labels, value: number) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Histogram observations must be finite and non-negative');
    const key = metricKey(this.labelNames, labels);
    let current = this.series.get(key);
    if (!current) {
      current = { labels: { ...labels }, count: 0, sum: 0, buckets: this.boundaries.map(() => 0) };
      this.series.set(key, current);
    }
    current.count += 1;
    current.sum += value;
    this.boundaries.forEach((boundary, index) => {
      if (value <= boundary) current!.buckets[index] = (current!.buckets[index] ?? 0) + 1;
    });
  }

  render() {
    const lines = this.header('histogram');
    for (const current of [...this.series.values()].sort((left, right) => metricKey(this.labelNames, left.labels).localeCompare(metricKey(this.labelNames, right.labels)))) {
      this.boundaries.forEach((boundary, index) => {
        lines.push(`${this.name}_bucket${renderLabels(this.labelNames, current.labels, { le: String(boundary) })} ${current.buckets[index]}`);
      });
      lines.push(`${this.name}_bucket${renderLabels(this.labelNames, current.labels, { le: '+Inf' })} ${current.count}`);
      lines.push(`${this.name}_sum${renderLabels(this.labelNames, current.labels)} ${current.sum}`);
      lines.push(`${this.name}_count${renderLabels(this.labelNames, current.labels)} ${current.count}`);
    }
    return lines;
  }
}

export class MetricsRegistry {
  private readonly families = new Map<string, MetricFamily>();

  counter(name: string, help: string, labelNames: readonly string[] = []) {
    return this.add(new Counter(name, help, labelNames));
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []) {
    return this.add(new Gauge(name, help, labelNames));
  }

  histogram(name: string, help: string, labelNames: readonly string[] = [], boundaries: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]) {
    return this.add(new Histogram(name, help, labelNames, boundaries));
  }

  renderPrometheus() {
    const lines = [...this.families.values()].sort((left, right) => left.name.localeCompare(right.name)).flatMap((family) => family.render());
    return `${lines.join('\n')}\n`;
  }

  private add<T extends MetricFamily>(family: T): T {
    if (this.families.has(family.name)) throw new Error(`Metric already registered: ${family.name}`);
    this.families.set(family.name, family);
    return family;
  }
}

export type AlertConfiguration = {
  windowMs: number;
  minimumTransactionSamples: number;
  deadlockRatioThreshold: number;
  retryExhaustedRatioThreshold: number;
  requestDeadlineCountThreshold: number;
  outboxLagMsThreshold: number;
  outboxDeadLetterCountThreshold: number;
  cooldownMs: number;
};

const defaultAlertConfiguration: AlertConfiguration = {
  windowMs: 300_000,
  minimumTransactionSamples: 20,
  deadlockRatioThreshold: 0.05,
  retryExhaustedRatioThreshold: 0.02,
  requestDeadlineCountThreshold: 5,
  outboxLagMsThreshold: 60_000,
  outboxDeadLetterCountThreshold: 1,
  cooldownMs: 300_000,
};

type WindowEvent = 'transaction_attempt' | 'deadlock' | 'retry_exhausted' | 'request_deadline' | 'outbox_dead_letter';
type AlertRule = 'DB_DEADLOCK_RATIO_HIGH' | 'TRANSACTION_RETRY_EXHAUSTED_RATIO_HIGH' | 'REQUEST_DEADLINE_RATE_HIGH' | 'OUTBOX_LAG_HIGH' | 'OUTBOX_DEAD_LETTER_PRESENT';
const ALERT_BUCKET_MS = 1_000;

export interface OperationalMetricsSink {
  recordHttpRequest(requestClass: string, method: string, status: number, durationMs: number): void;
  recordRequestDeadline(requestClass: string): void;
  recordClientDisconnect(requestClass: string): void;
  recordOptimisticConflict(requestClass: string): void;
  recordRateLimitRejected(scope: string): void;
  recordRateLimitStoreFailure(scope: string): void;
  recordTransactionAttempt(operation: string): void;
  recordTransactionDuration(operation: string, outcome: string, durationMs: number): void;
  recordTransactionFailure(operation: string, classification: string): void;
  recordTransactionRetry(operation: string, classification: string): void;
  recordTransactionRetryExhausted(operation: string, classification: string): void;
  recordOutboxProcessed(eventType: string, lagMs: number): void;
  recordOutboxRetry(eventType: string): void;
  recordOutboxDeadLetter(eventType: string): void;
  recordOutboxSnapshot(snapshot: { pending: number; processing: number; failed: number; oldestLagMs: number }): void;
}

const safeLabel = (value: string, fallback: string) => /^[A-Z0-9_]{1,80}$/u.test(value) ? value : fallback;

export class OperationalMetrics implements OperationalMetricsSink {
  readonly registry = new MetricsRegistry();
  private configuration: AlertConfiguration;
  private readonly now: () => number;
  // One counter per second keeps alert memory bounded by the configured window,
  // independently of request/transaction throughput.
  private readonly events = new Map<WindowEvent, Map<number, number>>();
  private readonly alertStates = new Map<AlertRule, { active: boolean; lastLoggedAt: number }>();
  private outboxLagMs = 0;
  private outboxFailed = 0;

  private readonly httpDuration = this.registry.histogram('mcap_http_request_duration_seconds', 'HTTP request duration by bounded request class, method and status.', ['request_class', 'method', 'status']);
  private readonly requestDeadlines = this.registry.counter('mcap_request_deadline_exceeded_total', 'Requests stopped after the shared application deadline.', ['request_class']);
  private readonly clientDisconnects = this.registry.counter('mcap_http_client_disconnected_total', 'Client connections closed before a response completed.', ['request_class']);
  private readonly transactionAttempts = this.registry.counter('mcap_db_transaction_attempt_total', 'Database transaction attempts by bounded operation.', ['operation']);
  private readonly transactionDuration = this.registry.histogram('mcap_db_transaction_duration_seconds', 'Database transaction attempt duration by bounded operation and outcome.', ['operation', 'outcome']);
  private readonly deadlocks = this.registry.counter('mcap_db_deadlock_total', 'Database deadlocks classified by the transaction executor.', ['operation']);
  private readonly lockWaitTimeouts = this.registry.counter('mcap_db_lock_wait_timeout_total', 'Database lock wait timeouts classified by the transaction executor.', ['operation']);
  private readonly writeConflicts = this.registry.counter('mcap_transaction_write_conflict_total', 'Retryable write conflicts classified by the transaction executor.', ['operation']);
  private readonly retries = this.registry.counter('mcap_transaction_retry_total', 'Scheduled complete transaction retries.', ['operation', 'classification']);
  private readonly retryExhausted = this.registry.counter('mcap_transaction_retry_exhausted_total', 'Transactions that exhausted their bounded retry attempts.', ['operation', 'classification']);
  private readonly optimisticConflicts = this.registry.counter('mcap_optimistic_conflict_total', 'Public optimistic version conflicts observed at the HTTP boundary.', ['request_class']);
  private readonly rateLimitRejections = this.registry.counter('mcap_rate_limit_rejected_total', 'Requests rejected by bounded rate-limit scope.', ['scope']);
  private readonly rateLimitStoreFailures = this.registry.counter('mcap_rate_limit_store_failure_total', 'Security-sensitive rate-limit store failures by bounded scope.', ['scope']);
  private readonly outboxProcessed = this.registry.counter('mcap_outbox_processed_total', 'Successfully processed outbox events by bounded event type.', ['event_type']);
  private readonly outboxRetries = this.registry.counter('mcap_outbox_retry_total', 'Outbox retries scheduled by bounded event type.', ['event_type']);
  private readonly outboxDeadLetters = this.registry.counter('mcap_outbox_dead_letter_total', 'Outbox events moved to the terminal failed state.', ['event_type']);
  private readonly outboxLag = this.registry.histogram('mcap_outbox_delivery_lag_seconds', 'Outbox delivery lag for successfully processed events.', ['event_type']);
  private readonly outboxEvents = this.registry.gauge('mcap_outbox_events', 'Current outbox event counts by non-terminal status.', ['status']);
  private readonly outboxOldestLag = this.registry.gauge('mcap_outbox_oldest_lag_seconds', 'Age of the oldest pending or processing outbox event.');
  private readonly activeAlerts = this.registry.gauge('mcap_operational_alert_active', 'Whether a built-in operational alert rule is currently active.', ['alert']);
  private readonly alertLastFired = this.registry.gauge('mcap_operational_alert_last_fired_timestamp_seconds', 'Unix timestamp of the latest built-in operational alert firing.', ['alert']);

  constructor(configuration: Partial<AlertConfiguration> = {}, dependencies: { now?: () => number } = {}) {
    this.configuration = { ...defaultAlertConfiguration, ...configuration };
    this.now = dependencies.now ?? Date.now;
  }

  configure(configuration: Partial<AlertConfiguration>) {
    this.configuration = { ...this.configuration, ...configuration };
    this.evaluateAlerts();
  }

  renderPrometheus() {
    this.evaluateAlerts();
    return this.registry.renderPrometheus();
  }

  recordHttpRequest(requestClass: string, method: string, status: number, durationMs: number) {
    this.httpDuration.observe({ request_class: safeLabel(requestClass, 'OTHER'), method: safeLabel(method, 'OTHER'), status: String(status) }, durationMs / 1_000);
  }

  recordRequestDeadline(requestClass: string) {
    this.requestDeadlines.increment({ request_class: safeLabel(requestClass, 'OTHER') });
    this.recordWindow('request_deadline');
  }

  recordClientDisconnect(requestClass: string) {
    this.clientDisconnects.increment({ request_class: safeLabel(requestClass, 'OTHER') });
  }

  recordOptimisticConflict(requestClass: string) {
    this.optimisticConflicts.increment({ request_class: safeLabel(requestClass, 'OTHER') });
  }

  recordRateLimitRejected(scope: string) {
    this.rateLimitRejections.increment({ scope: safeLabel(scope.toUpperCase().replaceAll('-', '_'), 'OTHER') });
  }

  recordRateLimitStoreFailure(scope: string) {
    this.rateLimitStoreFailures.increment({ scope: safeLabel(scope.toUpperCase().replaceAll('-', '_'), 'OTHER') });
  }

  recordTransactionAttempt(operation: string) {
    const safeOperation = safeLabel(operation, 'OTHER');
    this.transactionAttempts.increment({ operation: safeOperation });
    this.recordWindow('transaction_attempt');
  }

  recordTransactionDuration(operation: string, outcome: string, durationMs: number) {
    this.transactionDuration.observe({ operation: safeLabel(operation, 'OTHER'), outcome: safeLabel(outcome, 'OTHER') }, durationMs / 1_000);
  }

  recordTransactionFailure(operation: string, classification: string) {
    const labels = { operation: safeLabel(operation, 'OTHER') };
    if (classification === 'DEADLOCK') {
      this.deadlocks.increment(labels);
      this.recordWindow('deadlock');
    } else if (classification === 'LOCK_WAIT_TIMEOUT') {
      this.lockWaitTimeouts.increment(labels);
    } else if (classification === 'WRITE_CONFLICT') {
      this.writeConflicts.increment(labels);
    }
  }

  recordTransactionRetry(operation: string, classification: string) {
    this.retries.increment({ operation: safeLabel(operation, 'OTHER'), classification: safeLabel(classification, 'OTHER') });
  }

  recordTransactionRetryExhausted(operation: string, classification: string) {
    this.retryExhausted.increment({ operation: safeLabel(operation, 'OTHER'), classification: safeLabel(classification, 'OTHER') });
    this.recordWindow('retry_exhausted');
  }

  recordOutboxProcessed(eventType: string, lagMs: number) {
    const labels = { event_type: safeLabel(eventType.replaceAll(/(?<=[a-z0-9])(?=[A-Z])/gu, '_').toUpperCase(), 'OTHER') };
    this.outboxProcessed.increment(labels);
    this.outboxLag.observe(labels, lagMs / 1_000);
  }

  recordOutboxRetry(eventType: string) {
    this.outboxRetries.increment({ event_type: safeLabel(eventType.replaceAll(/(?<=[a-z0-9])(?=[A-Z])/gu, '_').toUpperCase(), 'OTHER') });
  }

  recordOutboxDeadLetter(eventType: string) {
    this.outboxDeadLetters.increment({ event_type: safeLabel(eventType.replaceAll(/(?<=[a-z0-9])(?=[A-Z])/gu, '_').toUpperCase(), 'OTHER') });
    this.recordWindow('outbox_dead_letter');
  }

  recordOutboxSnapshot(snapshot: { pending: number; processing: number; failed: number; oldestLagMs: number }) {
    this.outboxEvents.set({ status: 'PENDING' }, snapshot.pending);
    this.outboxEvents.set({ status: 'PROCESSING' }, snapshot.processing);
    this.outboxEvents.set({ status: 'FAILED' }, snapshot.failed);
    this.outboxOldestLag.set({}, snapshot.oldestLagMs / 1_000);
    this.outboxLagMs = snapshot.oldestLagMs;
    this.outboxFailed = snapshot.failed;
    this.evaluateAlerts();
  }

  private recordWindow(event: WindowEvent) {
    const now = this.now();
    const bucket = Math.floor(now / ALERT_BUCKET_MS) * ALERT_BUCKET_MS;
    const values = this.events.get(event) ?? new Map<number, number>();
    values.set(bucket, (values.get(bucket) ?? 0) + 1);
    this.events.set(event, values);
    this.evaluateAlerts();
  }

  private windowCount(event: WindowEvent, cutoff: number) {
    const values = this.events.get(event);
    if (!values) return 0;
    let count = 0;
    for (const [bucket, bucketCount] of values) {
      if (bucket + ALERT_BUCKET_MS <= cutoff) values.delete(bucket);
      else count += bucketCount;
    }
    return count;
  }

  private evaluateAlerts() {
    const now = this.now();
    const cutoff = now - this.configuration.windowMs;
    const attempts = this.windowCount('transaction_attempt', cutoff);
    const deadlocks = this.windowCount('deadlock', cutoff);
    const exhausted = this.windowCount('retry_exhausted', cutoff);
    const deadlines = this.windowCount('request_deadline', cutoff);
    const deadLetters = this.windowCount('outbox_dead_letter', cutoff);
    const enoughSamples = attempts >= this.configuration.minimumTransactionSamples;

    this.setAlert('DB_DEADLOCK_RATIO_HIGH', enoughSamples && deadlocks / attempts >= this.configuration.deadlockRatioThreshold, attempts ? deadlocks / attempts : 0, this.configuration.deadlockRatioThreshold, now);
    this.setAlert('TRANSACTION_RETRY_EXHAUSTED_RATIO_HIGH', enoughSamples && exhausted / attempts >= this.configuration.retryExhaustedRatioThreshold, attempts ? exhausted / attempts : 0, this.configuration.retryExhaustedRatioThreshold, now);
    this.setAlert('REQUEST_DEADLINE_RATE_HIGH', deadlines >= this.configuration.requestDeadlineCountThreshold, deadlines, this.configuration.requestDeadlineCountThreshold, now);
    this.setAlert('OUTBOX_LAG_HIGH', this.outboxLagMs >= this.configuration.outboxLagMsThreshold, this.outboxLagMs, this.configuration.outboxLagMsThreshold, now);
    this.setAlert('OUTBOX_DEAD_LETTER_PRESENT', this.outboxFailed >= this.configuration.outboxDeadLetterCountThreshold || deadLetters >= this.configuration.outboxDeadLetterCountThreshold, Math.max(this.outboxFailed, deadLetters), this.configuration.outboxDeadLetterCountThreshold, now);
  }

  private setAlert(rule: AlertRule, active: boolean, value: number, threshold: number, now: number) {
    const previous = this.alertStates.get(rule);
    this.activeAlerts.set({ alert: rule }, active ? 1 : 0);
    const transitioned = previous?.active !== active;
    const cooldownExpired = active && previous !== undefined && now - previous.lastLoggedAt >= this.configuration.cooldownMs;
    if (transitioned || cooldownExpired) {
      if (active) {
        this.alertLastFired.set({ alert: rule }, now / 1_000);
        logEvent('error', 'operational_alert_firing', { alert: rule, value, threshold, windowMs: this.configuration.windowMs });
      } else if (previous?.active) {
        logEvent('info', 'operational_alert_resolved', { alert: rule, value, threshold, windowMs: this.configuration.windowMs });
      }
    }
    this.alertStates.set(rule, { active, lastLoggedAt: transitioned || cooldownExpired ? now : previous?.lastLoggedAt ?? now });
  }
}

export const operationalMetrics = new OperationalMetrics();
