import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT} from './release-utils.mjs';
import {bindStage6Provenance, matchSdkContract, observeReadonlyBrokerMetadata, observeSdkInstallation} from './stage6-sdk-provenance.mjs';
import {admitStage6Run, profileSnapshot} from './stage6-admission.mjs';
import {openStage6Pilot, snapshotStage6Provenance} from './stage6-pilot-coordinator.mjs';

const hex = value => value.repeat(64), source = 'a'.repeat(40);
const canonical = value => value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha = value => createHash('sha256').update(canonical(value)).digest('hex');
const sdkCore = {schema: 'pi-sdk-provenance/1', package_name: '@earendil-works/pi-coding-agent', version: '1.0.4',
  export_entry: './dist/index.js', node_engine: '>=22.19.0', manifest_sha256: hex('1'), entry_sha256: hex('2'),
  coverage: 'manifest-and-public-entry', dependency_closure: 'not-observed', verification: 'metadata-only', authorization: 'none', executable: false};
const sdkObserved = Object.freeze({...sdkCore, identity_sha256: sha(sdkCore)});
const sdkExpected = Object.freeze({contract_id: 'fixture-public-1-0-4', package_name: sdkCore.package_name, version: sdkCore.version,
  export_entry: sdkCore.export_entry, node_engine: sdkCore.node_engine, manifest_sha256: sdkCore.manifest_sha256, entry_sha256: sdkCore.entry_sha256});
const sdkMatch = Object.freeze({schema: 'pi-sdk-contract-match/1', observed: sdkObserved, expected: sdkExpected, matched: true,
  reason_code: 'sdk-contract-match', observed_digest: sdkObserved.identity_sha256, expected_digest: sha(sdkExpected), verification: 'metadata-only', authorization: 'none', executable: false});
const changedSdkCore = Object.freeze({...sdkCore, version: '1.1.0-fork.1'});
const changedSdkObserved = Object.freeze({...changedSdkCore, identity_sha256: sha(changedSdkCore)});
const changedSdkMatch = Object.freeze({...sdkMatch, observed: changedSdkObserved, matched: false, reason_code: 'sdk-version-mismatch', observed_digest: changedSdkObserved.identity_sha256});
const broker = Object.freeze({schema: 'readonly-broker-provenance/1', provider: 'fixture-provider', matched: true,
  reason_code: 'broker-command-match', command_sha256: hex('3'), expected_command_sha256: hex('3'), target_path_sha256: hex('4'),
  target_metadata_sha256: hex('5'), verification: 'metadata-only', credential_bytes_read: false, authorization: 'none', executable: false});
const context = Object.freeze({provider: 'fixture-provider', model: 'fixture-model', thinking: 'max', sdk: sdkCore.version,
  arm: 'baseline', guidance_mode: 'none', guidance_digest: null, harness_source_sha: 'b'.repeat(40),
  subject_source_sha: source, subject_history_digest: hex('c'), broker_digest: broker.command_sha256});
const bindings = Object.freeze({run_id: 'run-fixture-01', repo: 'pi-vista', source_sha: source,
  policy_version: 'stage6-paired-evaluation-1', env_fingerprint: 'fixture-env', harness_source_sha: context.harness_source_sha,
  context_digest: null, artifact_digest: hex('f')});
const provenance = Object.freeze({schema: 'stage6-provenance/1', sdk: sdkMatch, broker, subject_source_sha: source,
  history_digest: context.subject_history_digest, bindings, verification: 'metadata-only', authorization: 'none', executable: false});
const profile = (p = 'a', v = 'c') => profileSnapshot({protected: {auth: hex(p)}, volatile: {root: hex(v)}});
const input = (extra = {}) => ({profileDirectory: '/fixture/stage6-profile', context, expected: context, expectedProvenance: provenance,
  bindings, model_calls: 0, max_requests: 16, deadline_ms: 10_000, ...extra});
function ports(sequence = [profile(), profile(), profile()], facts = [provenance, provenance]) {
  let reads = 0, collected = 0;
  return {value: {captureProfile: async () => sequence[Math.min(reads++, sequence.length - 1)],
    collectProvenance: async () => facts[Math.min(collected++, facts.length - 1)]},
  counts: () => ({reads, collected})};
}
function nativeSession() {
  let forwarded = 0;
  const session = {agent: {streamFunction() { forwarded++; return 'stream'; }}};
  return {session, get forwarded() { return forwarded; }};
}
const request = session => session.agent.streamFunction({provider: context.provider, id: context.model}, {}, {reasoning: context.thinking});

test('brackets collection/setup/window and finalizes once without promoting unchanged metadata to evaluation', async () => {
  const observed = ports();
  const window = await openStage6Pilot(input(), observed.value);
  assert.equal(window.status, 'admitted');
  assert.deepEqual(observed.counts(), {reads: 2, collected: 1});
  const firstPromise = window.finalize(), secondPromise = window.finalize();
  assert.equal(firstPromise, secondPromise);
  const result = await firstPromise;
  assert.deepEqual(observed.counts(), {reads: 3, collected: 2});
  assert.equal(result.integrity_status, 'unchanged'); assert.equal(result.reason_code, null);
  assert.equal(result.evaluation_status, 'not-evaluated'); assert.equal(result.pretransport_attempts, 0);
  assert.equal(result.authorization, 'none'); assert.equal(result.executable, false);
});

test('pre-admission calls and context mismatch refuse before profile/provenance access', async () => {
  const observed = ports();
  const prior = await openStage6Pilot(input({model_calls: 1}), observed.value);
  assert.equal(prior.reason_code, 'model-calls-before-admission'); assert.equal(prior.observed_pre_admission_calls, 1);
  const mismatch = await openStage6Pilot(input({expected: {...context, model: 'other-model'}}), observed.value);
  assert.equal(mismatch.reason_code, 'model-mismatch');
  assert.deepEqual(observed.counts(), {reads: 0, collected: 0});
});

test('setup protected/volatile drift refuses at admission with zero pretransport attempts', async () => {
  for (const [after, reason] of [[profile('b', 'c'), 'protected-profile-drift'], [profile('a', 'd'), 'volatile-profile-drift-unknown-attribution']]) {
    const window = await openStage6Pilot(input(), ports([profile(), after]).value);
    assert.equal(window.status, 'refused'); assert.equal(window.reason_code, reason); assert.equal(window.pretransport_attempts, 0);
  }
});

test('one private global budget spans distinct baseline/guided admissions and sessions', async () => {
  const window = await openStage6Pilot(input({max_requests: 2}), ports().value);
  const first = nativeSession(), second = nativeSession(), third = nativeSession();
  window.bindSession(first.session);
  const guidedContext = {...context, arm: 'guided', guidance_mode: 'historical-observed', guidance_digest: hex('9')};
  const guided = admitStage6Run({...guidedContext, profile_before: profile(), profile_after: profile(), model_calls: 0}, guidedContext);
  window.bindSession(second.session, guided); window.bindSession(third.session);
  assert.equal(request(first.session), 'stream'); assert.equal(request(second.session), 'stream');
  assert.throws(() => request(third.session), /round-budget/);
  assert.equal(third.forwarded, 0); assert.equal(first.forwarded, 1); assert.equal(second.forwarded, 1);
  const result = await window.finalize(); assert.equal(result.pretransport_attempts, 2);
});

test('session reuse, per-session limits, copied admission and model/thinking drift cannot forward', async () => {
  const window = await openStage6Pilot(input(), ports().value), native = nativeSession();
  const binding = window.bindSession(native.session);
  assert.throws(() => window.bindSession(native.session), /stage6-session-reused/);
  assert.throws(() => window.bindSession(nativeSession().session, {...window.admission}), /admission-required/);
  assert.throws(() => native.session.agent.streamFunction({provider: 'other', id: context.model}, {}, {reasoning: 'max'}), /stage6-model-binding-mismatch/);
  assert.throws(() => native.session.agent.streamFunction({provider: context.provider, id: context.model}, {}, {reasoning: 'high'}), /stage6-model-binding-mismatch/);
  request(native.session); request(native.session);
  assert.throws(() => request(native.session), /stage6-session-budget-exhausted/);
  const wrapper = native.session.agent.streamFunction;
  const result = await window.finalize(); assert.equal(result.pretransport_attempts, 2); assert.equal(binding.status().active, false);
  assert.throws(() => wrapper({provider: context.provider, id: context.model}, {}, {reasoning: 'max'}), /stage6-stream-withdrawn/);
  assert.throws(() => window.bindSession(nativeSession().session), /stage6-pilot-closed/);
});

test('final protected/volatile drift preserves actual attempt count with unknown attribution', async () => {
  for (const [after, reason] of [[profile('b', 'c'), 'protected-profile-drift'], [profile('a', 'd'), 'volatile-profile-drift-unknown-attribution']]) {
    const window = await openStage6Pilot(input(), ports([profile(), profile(), after]).value), native = nativeSession();
    window.bindSession(native.session); request(native.session);
    const result = await window.finalize();
    assert.equal(result.integrity_status, 'unknown'); assert.equal(result.reason_code, reason); assert.equal(result.pretransport_attempts, 1);
    assert.equal(result.drift.attribution, 'unknown'); assert.equal(result.evaluation_status, 'not-evaluated');
  }
});

test('SDK/broker/source/history binding mismatch or whole-window provenance drift cannot be unchanged', async () => {
  const changed = {...provenance, sdk: changedSdkMatch};
  const refused = await openStage6Pilot(input(), ports(undefined, [changed]).value);
  assert.equal(refused.reason_code, 'stage6-provenance-mismatch'); assert.equal(refused.pretransport_attempts, 0);
  const window = await openStage6Pilot(input(), ports(undefined, [provenance, changed]).value);
  const result = await window.finalize(); assert.equal(result.reason_code, 'stage6-provenance-drift'); assert.equal(result.integrity_status, 'unknown');
  for (const extra of [{subject_source_sha: 'b'.repeat(40)}, {history_digest: hex('8')}, {bindings: {...bindings, harness_source_sha: 'c'.repeat(40)}}]) {
    const candidate = await openStage6Pilot(input({expectedProvenance: {...provenance, ...extra}}), ports().value);
    assert.equal(candidate.status, 'refused');
  }
});

test('copyable metadata is accepted as metadata, not opaque proof, while raw fields/getters/proxies are rejected', async () => {
  assert.doesNotThrow(() => snapshotStage6Provenance(structuredClone(provenance)));
  assert.throws(() => snapshotStage6Provenance({...provenance, sdk: {...provenance.sdk, path: '/private/path'}}), /stage6-provenance-refused/);
  assert.throws(() => snapshotStage6Provenance({...provenance, executable: true}), /stage6-provenance-refused/);
  let reads = 0;
  const accessor = Object.defineProperty(input(), 'context', {get() {reads++; throw Error('PRIVATE');}});
  const proxy = new Proxy(input(), {get() {reads++; throw Error('PRIVATE');}, ownKeys() {reads++; throw Error('PRIVATE');}});
  for (const bad of [accessor, proxy]) {
    const result = await openStage6Pilot(bad, ports().value);
    assert.equal(result.reason_code, 'stage6-coordinator-refused'); assert.equal(result.pretransport_attempts, 0);
  }
  assert.equal(reads, 0);
});

test('embedded credential signatures in coordinator bindings refuse before host reads', async () => {
  let reads = 0;
  const result = await openStage6Pilot(input({bindings: {...bindings, env_fingerprint: 'env-sk-12345678'}}), {
    captureProfile: async () => { reads++; return profile(); }, collectProvenance: async () => provenance,
  });
  assert.equal(result.reason_code, 'stage6-provenance-refused'); assert.equal(reads, 0);
});

test('collection failure and final read failure preserve fixed diagnostics and do not fabricate full provenance', async () => {
  const refused = await openStage6Pilot(input(), {captureProfile: async () => {throw Error('PRIVATE_PROFILE');}, collectProvenance: async () => provenance});
  assert.equal(refused.reason_code, 'stage6-collection-unavailable'); assert.doesNotMatch(JSON.stringify(refused), /PRIVATE/);
  let reads = 0;
  const window = await openStage6Pilot(input(), {captureProfile: async () => {if (++reads === 3) throw Error('PRIVATE_FINAL'); return profile();}, collectProvenance: async () => provenance});
  const result = await window.finalize();
  assert.equal(result.reason_code, 'stage6-profile-unavailable'); assert.equal(result.profile_after_digest, null);
  assert.equal(result.integrity_status, 'unknown'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test('a hung collection is bounded and refuses only the evaluation without forwarding any request', {timeout: 3000}, async () => {
  const result = await openStage6Pilot(input({deadline_ms: 30}), {captureProfile: async () => new Promise(() => {}), collectProvenance: async () => provenance});
  assert.equal(result.status, 'refused'); assert.equal(result.reason_code, 'stage6-window-deadline');
  assert.equal(result.pretransport_attempts, 0); assert.equal(result.evaluation_status, 'not-evaluated');
});

test('hostile binding options and invalid global limits cannot invoke getters or reset the budget', async () => {
  let calls = 0;
  const observed = ports();
  for (const max_requests of [0, 17, 1.5]) {
    assert.equal((await openStage6Pilot(input({max_requests}), observed.value)).reason_code, 'stage6-coordinator-refused');
  }
  assert.deepEqual(observed.counts(), {reads: 0, collected: 0});
  const window = await openStage6Pilot(input(), ports().value);
  const proxy = new Proxy({}, {ownKeys() {calls++; throw Error('PRIVATE');}});
  const getter = Object.defineProperty({}, 'maxPerSession', {get() {calls++; throw Error('PRIVATE');}});
  for (const bad of [proxy, getter]) assert.throws(() => window.bindSession(nativeSession().session, window.admission, bad), /stage6-coordinator-refused/);
  assert.equal(calls, 0); await window.finalize();
});

test('real fixture collectors compose with native profile bracket and preserve exact SDK/broker files', async () => {
  await mkdir(join(ROOT, 'tmp'), {recursive: true});
  const root = await mkdtemp(join(ROOT, 'tmp', 'stage6-window-fixture-'));
  try {
    const sdkRoot = join(root, 'sdk'), profileRoot = join(root, 'profile');
    await mkdir(join(sdkRoot, 'dist'), {recursive: true}); await mkdir(profileRoot, {mode: 0o700});
    const manifest = {name: '@earendil-works/pi-coding-agent', version: '1.0.4', exports: {'.': {import: './dist/index.js'}}, engines: {node: '>=22.19.0'}};
    await writeFile(join(sdkRoot, 'package.json'), JSON.stringify(manifest)); await writeFile(join(sdkRoot, 'dist/index.js'), '// synthetic public entry\n');
    for (const name of ['auth.json', 'models.json', 'settings.json']) await writeFile(join(profileRoot, name), '{}', {mode: 0o600});
    const secretFile = join(profileRoot, 'fixture-key'); const secret = 'PRIVATE_SYNTHETIC_CREDENTIAL';
    await writeFile(secretFile, secret, {mode: 0o600});
    const command = `cat ${secretFile}`, commandHash = createHash('sha256').update(command).digest('hex');
    const sdkFirst = await observeSdkInstallation(sdkRoot);
    const sdkContract = {contract_id: 'synthetic-sdk', package_name: sdkFirst.package_name, version: sdkFirst.version,
      export_entry: sdkFirst.export_entry, node_engine: sdkFirst.node_engine, manifest_sha256: sdkFirst.manifest_sha256, entry_sha256: sdkFirst.entry_sha256};
    const collectProvenance = async () => bindStage6Provenance({sdk: matchSdkContract(await observeSdkInstallation(sdkRoot), sdkContract),
      broker: await observeReadonlyBrokerMetadata({profile_directory: profileRoot, provider: context.provider, command, expected_command_sha256: commandHash}),
      subject_source_sha: source, history_digest: context.subject_history_digest, bindings});
    const expectedProvenance = await collectProvenance(), hostContext = {...context, broker_digest: commandHash};
    const window = await openStage6Pilot(input({profileDirectory: profileRoot, context: hostContext, expected: hostContext, expectedProvenance}),
      {captureProfile: null, collectProvenance});
    assert.equal(window.status, 'admitted'); const native = nativeSession(); window.bindSession(native.session); request(native.session);
    const result = await window.finalize();
    assert.equal(result.integrity_status, 'unchanged'); assert.equal(result.pretransport_attempts, 1);
    assert.equal(result.evaluation_status, 'not-evaluated'); assert.equal(await readFile(secretFile, 'utf8'), secret);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|fixture-key|cat |\/Users\/|\/home\//);
  } finally {await rm(root, {recursive: true, force: true});}
});
