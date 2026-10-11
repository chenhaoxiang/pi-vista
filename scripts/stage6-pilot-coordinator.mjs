import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {hasKnownCredential} from '@pi-vista/core';
import {createBudget, failureCode} from './pi-agent-canary-support.mjs';
import {captureStage6Profile, bindStage6Stream} from './stage6-host-admission.mjs';
import {validateStage6Provenance as validateSdkStage6Provenance} from './stage6-sdk-provenance.mjs';
import {admitStage6Run, classifyProfileDrift, createAdmissionRequestBudget, profileDigest, profileSnapshot, snapshotStage6Context} from './stage6-admission.mjs';

const SCHEMA = 'stage6-pilot-window/1';
const COMMON_CONTEXT = ['provider', 'model', 'thinking', 'sdk', 'harness_source_sha', 'subject_source_sha', 'subject_history_digest', 'broker_digest'];
const INPUT_KEYS = ['profileDirectory', 'context', 'expected', 'bindings', 'expectedProvenance', 'model_calls', 'max_requests', 'deadline_ms'];
const BINDING_KEYS = ['run_id', 'repo', 'source_sha', 'policy_version', 'env_fingerprint', 'harness_source_sha', 'context_digest', 'artifact_digest'];
const HEX64 = /^[a-f0-9]{64}$/u;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const SAFE_REASONS = new Set(['stage6-coordinator-refused', 'stage6-provenance-refused', 'stage6-provenance-mismatch', 'stage6-profile-unavailable', 'stage6-admission-refused', 'stage6-sdk-installation-refused', 'stage6-sdk-contract-refused', 'stage6-sdk-broker-refused', 'stage6-sdk-binding-refused']);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const activeAgents = new WeakSet();
const unavailable = reason => { throw Error(reason); };

function own(input, keys, reason = 'stage6-coordinator-refused') {
  if (!input || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== keys.length) unavailable(reason);
  const result = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(input, key);
    if (!p || !Object.hasOwn(p, 'value') || p.value === undefined) unavailable(reason);
    result[key] = p.value;
  }
  return result;
}

function bindingsSnapshot(input) {
  const value = own(input, BINDING_KEYS, 'stage6-provenance-refused');
  for (const key of ['run_id', 'repo', 'policy_version']) if (typeof value[key] !== 'string' || !LABEL.test(value[key]) || hasKnownCredential(value[key])) unavailable('stage6-provenance-refused');
  for (const key of ['source_sha', 'harness_source_sha']) if (typeof value[key] !== 'string' || !SHA.test(value[key])) unavailable('stage6-provenance-refused');
  if (typeof value.env_fingerprint !== 'string' || !LABEL.test(value.env_fingerprint) || hasKnownCredential(value.env_fingerprint)) unavailable('stage6-provenance-refused');
  if (value.context_digest !== null && (typeof value.context_digest !== 'string' || !HEX64.test(value.context_digest))) unavailable('stage6-provenance-refused');
  if (typeof value.artifact_digest !== 'string' || !HEX64.test(value.artifact_digest)) unavailable('stage6-provenance-refused');
  return Object.freeze(value);
}

// Reuse the paired SDK/broker validator. The DTO is copyable metadata, not an
// opaque proof; the validator detaches nested values and rejects permission fields.
export function snapshotStage6Provenance(input) {
  try { return validateSdkStage6Provenance(input); }
  catch { unavailable('stage6-provenance-refused'); }
}

function refused(reason_code, model_calls) {
  return Object.freeze({schema: SCHEMA, status: 'refused', reason_code, observed_pre_admission_calls: model_calls,
    pretransport_attempts: 0, evaluation_status: 'not-evaluated', verification: 'metadata-only', authorization: 'none', executable: false});
}

/** Trusted-host evaluation seam only; no CLI, default Pi entry or model call.
 * collectProvenance is explicit and is re-run at finalization. One private budget
 * is shared by every arm/session, while the existing seam enforces two per session.
 */
export async function openStage6Pilot(input, ports) {
  let value, context, bindings, expectedProvenance, before, admission, captureProfile, collectProvenance, sharedBudget;
  let observedCalls = null;
  try {
    value = own(input, INPUT_KEYS);
    if (!Number.isSafeInteger(value.model_calls) || value.model_calls < 0 || !Number.isSafeInteger(value.max_requests) || value.max_requests < 1 || value.max_requests > 16 ||
        !Number.isSafeInteger(value.deadline_ms) || value.deadline_ms < 1 || value.deadline_ms > 1_200_000) unavailable('stage6-coordinator-refused');
    observedCalls = value.model_calls;
    if (observedCalls !== 0) return refused('model-calls-before-admission', observedCalls);
    context = snapshotStage6Context(value.context);
    const expected = snapshotStage6Context(value.expected);
    const mismatch = Object.keys(context).find(key => context[key] !== expected[key]);
    if (mismatch) return refused(`${mismatch.replaceAll('_', '-')}-mismatch`, observedCalls);
    bindings = bindingsSnapshot(value.bindings);
    expectedProvenance = snapshotStage6Provenance(value.expectedProvenance);
    if (digest(bindings) !== digest(expectedProvenance.bindings) || bindings.source_sha !== context.subject_source_sha ||
        bindings.harness_source_sha !== context.harness_source_sha || expectedProvenance.history_digest !== context.subject_history_digest ||
        !expectedProvenance.sdk.matched || expectedProvenance.sdk.observed.version !== context.sdk ||
        !expectedProvenance.broker.matched || expectedProvenance.broker.provider !== context.provider ||
        expectedProvenance.broker.command_sha256 !== context.broker_digest) unavailable('stage6-provenance-mismatch');
    const port = own(ports, ['captureProfile', 'collectProvenance']);
    captureProfile = port.captureProfile ?? captureStage6Profile;
    collectProvenance = port.collectProvenance;
    if (typeof captureProfile !== 'function' || typeof collectProvenance !== 'function') unavailable('stage6-coordinator-refused');
    sharedBudget = createBudget({provider: context.provider, model: context.model, thinking: context.thinking,
      'deadline-ms': value.deadline_ms, 'max-model-rounds': value.max_requests});
    before = profileSnapshot(await sharedBudget.wait(Promise.resolve().then(() => captureProfile(value.profileDirectory))));
    const observed = snapshotStage6Provenance(await sharedBudget.wait(Promise.resolve().then(() => collectProvenance())));
    if (digest(observed) !== digest(expectedProvenance)) return refused('stage6-provenance-mismatch', observedCalls);
    const afterSetup = profileSnapshot(await sharedBudget.wait(Promise.resolve().then(() => captureProfile(value.profileDirectory))));
    admission = admitStage6Run({...context, profile_before: before, profile_after: afterSetup, model_calls: observedCalls}, expected);
  } catch (error) {
    return refused(failureCode(error) === 'deadline' ? 'stage6-window-deadline' : SAFE_REASONS.has(error?.message) ? error.message : 'stage6-collection-unavailable', observedCalls);
  }
  if (!admission.admitted) return refused(admission.reason_code, admission.model_calls);

  const sessions = new WeakSet(), agents = new WeakSet(), streamBindings = [];
  let active = true, finalPromise;
  const budget = {take(model, thinking) { if (!active) unavailable('stage6-pilot-closed'); sharedBudget.take(model, thinking); }};
  return Object.freeze({
    schema: SCHEMA, status: 'admitted', admission,
    statusSnapshot() { return Object.freeze({active, pretransport_attempts: sharedBudget.attempts, max_requests: value.max_requests, authorization: 'none', executable: false}); },
    bindSession(session, rowAdmission = admission, options = {}) {
      if (!active) unavailable('stage6-pilot-closed');
      if (!session || typeof session !== 'object' || sessions.has(session)) unavailable('stage6-session-reused');
      if (!session.agent || typeof session.agent !== 'object' || agents.has(session.agent) || activeAgents.has(session.agent)) unavailable('stage6-agent-reused');
      createAdmissionRequestBudget(rowAdmission, 16); // Reject copies before reading their fields.
      if (COMMON_CONTEXT.some(key => rowAdmission[key] !== context[key])) unavailable('stage6-row-context-mismatch');
      if (!options || typeof options !== 'object' || Array.isArray(options) || types.isProxy(options) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(options))) unavailable('stage6-coordinator-refused');
      const names = Reflect.ownKeys(options);
      if (names.some(name => !['maxPerSession', 'requestGuard'].includes(name))) unavailable('stage6-coordinator-refused');
      const opts = own(options, names);
      const binding = bindStage6Stream(session, rowAdmission, budget, opts);
      sessions.add(session); agents.add(session.agent); activeAgents.add(session.agent); streamBindings.push({binding, agent: session.agent}); return binding;
    },
    finalize() {
      if (finalPromise) return finalPromise;
      active = false;
      let shutdownFailed = false;
      for (const entry of [...streamBindings].reverse()) {
        try { entry.binding.shutdown(); }
        catch { shutdownFailed = true; }
        finally { activeAgents.delete(entry.agent); }
      }
      finalPromise = (async () => {
        let after, drift, afterProvenance, reason = null;
        try { after = profileSnapshot(await sharedBudget.wait(Promise.resolve().then(() => captureProfile(value.profileDirectory)))); drift = classifyProfileDrift(before, after); }
        catch (error) { reason = failureCode(error) === 'deadline' ? 'stage6-window-deadline' : 'stage6-profile-unavailable'; }
        try { afterProvenance = snapshotStage6Provenance(await sharedBudget.wait(Promise.resolve().then(() => collectProvenance()))); }
        catch (error) { reason ??= failureCode(error) === 'deadline' ? 'stage6-window-deadline' : 'stage6-provenance-unavailable'; }
        if (drift && drift.classification !== 'unchanged') reason ??= drift.classification;
        if (afterProvenance && digest(afterProvenance) !== digest(expectedProvenance)) reason ??= 'stage6-provenance-drift';
        if (shutdownFailed) reason ??= 'stage6-shutdown-failed';
        return Object.freeze({schema: SCHEMA, status: 'closed', reason_code: reason,
          integrity_status: reason === null ? 'unchanged' : 'unknown', evaluation_status: 'not-evaluated',
          observed_pre_admission_calls: observedCalls, pretransport_attempts: sharedBudget.attempts, max_requests: value.max_requests,
          profile_before_digest: profileDigest(before), profile_after_digest: after ? profileDigest(after) : null, drift: drift ?? null,
          provenance_before_digest: digest(expectedProvenance), provenance_after_digest: afterProvenance ? digest(afterProvenance) : null,
          verification: 'metadata-only', authorization: 'none', executable: false});
      })();
      return finalPromise;
    },
  });
}
