import { describe, expect, it, vi } from 'vitest';
import { MetricsRegistry, OperationalMetrics } from '../src/operations/metrics.js';

describe('MetricsRegistry', () => {
  it('renders counters, gauges and histograms in Prometheus text format', () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter('test_events_total', 'Test events.', ['kind']);
    const gauge = registry.gauge('test_depth', 'Current depth.');
    const histogram = registry.histogram('test_duration_seconds', 'Test duration.', ['operation'], [0.1, 1]);
    counter.increment({ kind: 'SAFE' }, 2);
    gauge.set({}, 3);
    histogram.observe({ operation: 'POST' }, 0.5);

    expect(registry.renderPrometheus()).toContain('test_events_total{kind="SAFE"} 2');
    expect(registry.renderPrometheus()).toContain('test_depth 3');
    expect(registry.renderPrometheus()).toContain('test_duration_seconds_bucket{operation="POST",le="1"} 1');
    expect(registry.renderPrometheus()).toContain('test_duration_seconds_count{operation="POST"} 1');
  });
});

describe('operational metrics and alert rules', () => {
  it('exposes bounded transaction, deadline and outbox signals without sensitive labels', () => {
    const metrics = new OperationalMetrics({
      minimumTransactionSamples: 1,
      deadlockRatioThreshold: 0.5,
      retryExhaustedRatioThreshold: 1,
      requestDeadlineCountThreshold: 1,
      outboxLagMsThreshold: 1_000,
      outboxDeadLetterCountThreshold: 1,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    metrics.recordTransactionAttempt('POST_SALES_INVOICE');
    metrics.recordTransactionFailure('POST_SALES_INVOICE', 'DEADLOCK');
    metrics.recordTransactionRetry('POST_SALES_INVOICE', 'DEADLOCK');
    metrics.recordTransactionDuration('POST_SALES_INVOICE', 'DEADLOCK', 25);
    metrics.recordRequestDeadline('WRITE');
    metrics.recordOptimisticConflict('WRITE');
    metrics.recordOutboxDeadLetter('RegistrationVerificationRequested');
    metrics.recordOutboxSnapshot({ pending: 2, processing: 1, failed: 1, oldestLagMs: 2_000 });

    const output = metrics.renderPrometheus();
    expect(output).toContain('mcap_db_deadlock_total{operation="POST_SALES_INVOICE"} 1');
    expect(output).toContain('mcap_transaction_retry_total{operation="POST_SALES_INVOICE",classification="DEADLOCK"} 1');
    expect(output).toContain('mcap_request_deadline_exceeded_total{request_class="WRITE"} 1');
    expect(output).toContain('mcap_outbox_events{status="FAILED"} 1');
    expect(output).toContain('mcap_operational_alert_active{alert="DB_DEADLOCK_RATIO_HIGH"} 1');
    expect(output).toContain('mcap_operational_alert_active{alert="OUTBOX_LAG_HIGH"} 1');
    expect(output).not.toContain('companyId');
    expect(output).not.toContain('requestId');
    consoleError.mockRestore();
  });

  it('bounds unsafe operation labels instead of exposing arbitrary values', () => {
    const metrics = new OperationalMetrics();
    metrics.recordTransactionAttempt('tenant/42?token=secret');
    const output = metrics.renderPrometheus();
    expect(output).toContain('mcap_db_transaction_attempt_total{operation="OTHER"} 1');
    expect(output).not.toContain('secret');
  });
});
