import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecordTemplate, summarizeObservedRecords } from '../scripts/ai-capability-evaluation.mjs';

// Invented DTOs only: never read historical task/session data in tests.
function syntheticInput() {
  const input = createRecordTemplate();
  input.records = input.records.slice(0, 4).map((row, index) => ({
    ...row, run_id: 'run-ab', arm: 'single', completion: index === 3 ? 'partial' : 'pass',
    rework_count: index, human_interventions: 0,
  }));
  return input;
}

test('a supplied single-arm projection preserves synthetic counts and incomplete coverage', () => {
  const report = summarizeObservedRecords(syntheticInput());
  assert.deepEqual(Object.keys(report.by_arm), ['single']);
  const arm = report.by_arm.single;
  assert.equal(arm.records, 4);
  assert.deepEqual(arm.metrics.completion.counts, { pass: 3, partial: 1, fail: 0, unknown: 0 });
  assert.equal(arm.metrics.rework_count.total, 6);
  assert.equal(arm.metrics.human_interventions.total, 0);
  for (const key of ['tool_calls', 'elapsed_ms', 'context_tokens', 'output_tokens', 'false_intercepts']) {
    assert.equal(arm.metrics[key].missing, 4);
    assert.equal(arm.metrics[key].total, null);
  }
  assert.equal(arm.false_intercept.rate, null);
});

test('synthetic single-arm history cannot create ROI, authority or execution permission', () => {
  const report = summarizeObservedRecords(syntheticInput());
  assert.equal(report.measurement_status, 'supplied-not-authenticated');
  assert.equal(report.capability_claim, 'not-assessed');
  assert.equal(report.cost_status, 'unpriced');
  assert.equal(report.roi, null);
  assert.deepEqual(report.safety, { observation: 'recorded-only', verification: 'metadata-only', authorization: 'none', executable: false });
});
