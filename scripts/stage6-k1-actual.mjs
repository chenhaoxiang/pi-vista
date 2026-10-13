import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { types, promisify } from "node:util";
import { createLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { createHindsightGuidanceStore } from "@pi-vista/learning/guidance";
import { prepareK1ActualHistory } from "./stage6-k1-history-host.mjs";
import { runK1Pilot } from "./stage6-k1-pilot.mjs";
import { createK1NativeFactory } from "./stage6-k1-native.mjs";
import { captureStage6Profile } from "./stage6-host-admission.mjs";
import { bindStage6Provenance, matchSdkContract, observeSdkInstallation, observeReadonlyBrokerMetadata, PUBLIC_1_0_4_CONTRACT } from "./stage6-sdk-provenance.mjs";
import { workflowNativeSuite } from "./local-learning-workflow.mjs";
import { createHostPlanLedger } from "./local-host-acceptance.mjs";
import { readGuidanceCredential, checkGuidanceServiceFingerprint } from "./hindsight-guidance-acceptance.mjs";
import { readGuidanceMetadata, readGuidanceBankPreflight } from "./guidance-acceptance-io.mjs";
import { privateRead } from "./pi-agent-canary-support.mjs";
import { ROOT, commandEnvironment, isMain, listFiles, readJson } from "./release-utils.mjs";
import { PAIR_SOURCE_SHA, PAIR_HISTORY_DIGEST, PAIR_TIMEOUT_MS } from "./paired-evaluation-data.mjs";

const exec = promisify(execFile), sha = x => createHash("sha256").update(x).digest("hex");
const ENDPOINT = "http://127.0.0.1:8888", BANK = "pi-vista-local-test-01a114ab", ALIAS = "stage5-isolated-test", SCOPE = "fixed-local-learning-command-plan-v1";
const PLAN = Object.freeze(["source-contract", "learning-native", "packed-consumer-contract"]);
const ARG_KEYS = ["sdk", "profile-dir", "broker-pin", "history-reference", "credential-config", "service-fingerprint", "subject-root", "harness-source-sha"];
let armTerminalWatchdog; // CLI-only host hook; imports and programmatic use install none.
const refused = () => { throw Error("stage6-k1-actual-options-refused"); };
export function parseK1ActualOptions(args) {
  if (types.isProxy(args) || !Array.isArray(args) || Object.getPrototypeOf(args) !== Array.prototype || args.length !== 9 || Reflect.ownKeys(args).length !== 10) refused();
  const out = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const p = Object.getOwnPropertyDescriptor(args, String(i)); if (!p || !Object.hasOwn(p, "value") || typeof p.value !== "string") refused();
    if (p.value === "--allow-live" && !Object.hasOwn(out, "allow-live")) { out["allow-live"] = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/u.exec(p.value); if (!match || !ARG_KEYS.includes(match[1]) || Object.hasOwn(out, match[1])) refused(); out[match[1]] = match[2];
  }
  if (out["allow-live"] !== true || ARG_KEYS.some(k => !Object.hasOwn(out, k))) refused();
  for (const k of ["sdk", "profile-dir", "history-reference", "credential-config", "service-fingerprint", "subject-root"]) if (!isAbsolute(out[k]) || normalize(out[k]) !== out[k] || /[\x00-\x1f\x7f]/u.test(out[k])) refused();
  if (!/^[a-f0-9]{64}$/u.test(out["broker-pin"]) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(out["harness-source-sha"])) refused();
  const [major, minor] = process.versions.node.split(".").map(Number); if (!(major > 22 || major === 22 && minor >= 19)) refused();
  return Object.freeze(out);
}
async function sourceCheck(root, sha) {
  const options = { cwd: root, env: commandEnvironment(), shell: false, timeout: 10_000, maxBuffer: 8192 };
  const head = (await exec("git", ["rev-parse", "HEAD"], options)).stdout.trim();
  const dirty = (await exec("git", ["status", "--porcelain=v1", "--untracked-files=normal"], options)).stdout.trim();
  if (head !== sha || dirty) throw Error("stage6-k1-actual-source-drift");
}
function safeFailure(error) {
  const message = error && typeof error === "object" && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, "message") : null;
  return message && Object.hasOwn(message, "value") && typeof message.value === "string" && /^(?:stage6-k1-|guidance-)[a-z-]+$/u.test(message.value) ? message.value : "stage6-k1-actual-unavailable";
}

/** Operator child only. Run via explicit --allow-live options after source/mock
 * review. Reads exactly the already-accepted Stage5 document and the selected
 * readonly credential sources; does not retain/recall/reconcile or mutate bank.
 */
export async function runK1Actual(options) {
  const keys = [...ARG_KEYS, "allow-live"];
  if (types.isProxy(options) || !options || typeof options !== "object" || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).length !== keys.length) refused();
  const selected = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(options, key);
    if (!p || !Object.hasOwn(p, "value") || (key === "allow-live" ? p.value !== true : typeof p.value !== "string")) refused();
    selected[key] = p.value;
  }
  const c = parseK1ActualOptions([...ARG_KEYS.map(k => `--${k}=${selected[k]}`), "--allow-live"]);
  const outputRoot = join(ROOT, "tmp", "k1-actual"); await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(outputRoot, "run-")), run = `k1-${randomUUID()}`;
  let verifier, history, factory, captured = 0;
  const report = { schema: "stage6-k1-actual/1", status: "unknown", phase: "preparation", harness_source_sha: c["harness-source-sha"], subject_source_sha: PAIR_SOURCE_SHA,
    model_calls: 0, bank_write_calls: 0, bank_read_calls: 0, history: null, pilot: null, failure: null, authorization: "none", executable: false };
  try {
    await sourceCheck(ROOT, c["harness-source-sha"]); await sourceCheck(c["subject-root"], PAIR_SOURCE_SHA);
    const sdk = matchSdkContract(await observeSdkInstallation(c.sdk), PUBLIC_1_0_4_CONTRACT); if (!sdk.matched) throw Error("stage6-k1-sdk-mismatch");
    const config = JSON.parse(await privateRead(join(c["profile-dir"], "models.json"))), command = config.providers?.["codex-local-8319"]?.apiKey;
    if (typeof command !== "string" || !command.startsWith("!")) throw Error("stage6-k1-broker-mismatch");
    const broker = await observeReadonlyBrokerMetadata({ profile_directory: c["profile-dir"], provider: "codex-local-8319", command, expected_command_sha256: c["broker-pin"] });
    if (!broker.matched) throw Error("stage6-k1-broker-mismatch");
    const saved = JSON.parse(await privateRead(c["history-reference"]));
    if (saved.content_digest !== PAIR_HISTORY_DIGEST || !saved.reference) throw Error("stage6-k1-history-reference-mismatch");
    // Fixed subject commands produce new native observations, never stored flags.
    const ledger = createHostPlanLedger(PLAN), nativeDir = join(directory, "native"); await mkdir(nativeDir, { mode: 0o700 });
    const commandRun = async (name, args, extra = {}) => {
      ledger.admit(name);
      try { const result = await exec(process.execPath, args, { cwd: c["subject-root"], env: { ...commandEnvironment(), ...extra }, shell: false, timeout: PAIR_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
        await writeFile(join(nativeDir, `${name}.log`), `exit:0\n${result.stdout}\n${result.stderr}`, { mode: 0o600, flag: "wx" }); ledger.settle(name, true); return result;
      } catch (error) {
        ledger.settle(name, false);
        await writeFile(join(nativeDir, `${name}.log`), `exit:${Number.isSafeInteger(error.code) ? error.code : "unknown"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`, { mode: 0o600, flag: "wx" });
        throw Error("stage6-k1-subject-command-failed");
      }
    };
    await commandRun(PLAN[0], [join(c["subject-root"], "scripts/source-gate.mjs")]);
    const compiled = join(c["subject-root"], "packages/learning/dist-test");
    const files = (await listFiles(compiled)).filter(p => p.endsWith(".test.js")).map(p => join(compiled, p));
    const counts = join(nativeDir, "counts.json");
    await commandRun(PLAN[1], ["--test", `--test-reporter=${join(c["subject-root"], "scripts/test-count-reporter.mjs")}`, ...files], { PI_VISTA_TEST_COUNT_FILE: counts, PI_VISTA_TEST_FILES: JSON.stringify(files) });
    const suite = workflowNativeSuite(await readJson(counts), files);
    await commandRun(PLAN[2], [join(c["subject-root"], "scripts/packed-consumer.mjs")]);
    await sourceCheck(c["subject-root"], PAIR_SOURCE_SHA); await sourceCheck(ROOT, c["harness-source-sha"]);
    const historical = saved.preview_projection?.document;
    if (!historical || historical.content_digest !== PAIR_HISTORY_DIGEST || sha(historical.content) !== PAIR_HISTORY_DIGEST) throw Error("stage6-k1-history-reference-mismatch");
    const old = JSON.parse(historical.content).experience;
    const expected = { run_id: run, repo: old.repo, source_sha: old.source_sha, policy_version: old.policy_version, env_fingerprint: old.env_fingerprint };
    const measuredEnvironment = sha(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, scope: SCOPE, plan: PLAN }));
    if (expected.source_sha !== PAIR_SOURCE_SHA || expected.repo !== "pi-vista" || expected.policy_version !== "local-learning-workflow-v1" ||
        expected.env_fingerprint !== measuredEnvironment) throw Error("stage6-k1-history-reference-mismatch");
    const stamp = Date.now(), configDigest = sha(JSON.stringify({ scope: SCOPE, plan: PLAN, subject: PAIR_SOURCE_SHA }));
    const observations = Object.fromEntries(["gate", "test", "guard"].map(kind => [kind, { schema: 1, scope: SCOPE, kind, producer: `k1-${kind}`, ...expected,
      result_ref: `${run}-${kind}`, observed_at: stamp, expires_at: stamp + PAIR_TIMEOUT_MS,
      details: kind === "gate" ? { verdict: "pass", gate_version: PAIR_SOURCE_SHA, config_digest: configDigest,
        checks: PLAN.map(name => ({ name, outcome: "pass" })) } : kind === "test" ? { suites: [suite] } : ledger.details() }]));
    verifier = createLocalEvidenceVerifier({ mode: "local-host", scope: SCOPE, gate_checks: PLAN, gate_version: PAIR_SOURCE_SHA, gate_config_digest: configDigest, test_suites: [suite.name], now: Date.now, max_age_ms: PAIR_TIMEOUT_MS, timeout_ms: 10_000,
      sources: ["gate", "test", "guard"].map(kind => ({ subject: kind, kind, producer: `k1-${kind}`, collect: async () => { await sourceCheck(c["subject-root"], PAIR_SOURCE_SHA); return observations[kind]; } })) });
    await checkGuidanceServiceFingerprint(c["service-fingerprint"]);
    await readGuidanceMetadata(await fetch(ENDPOINT + "/openapi.json", { signal: AbortSignal.timeout(5000), credentials: "omit", redirect: "error", cache: "no-store" }));
    const token = await readGuidanceCredential(c["credential-config"]);
    report.bank_read_calls++;
    const bankBaseline = await readGuidanceBankPreflight(await fetch(`${ENDPOINT}/v1/default/banks/${BANK}/config`, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), credentials: "omit", redirect: "error", cache: "no-store" }));
    const originalFetch = globalThis.fetch;
    let store;
    try {
      globalThis.fetch = async (url, init) => {
        const target = new URL(url), wanted = `/v1/default/banks/${BANK}/documents/${saved.reference.document_id}`;
        if (target.origin !== ENDPOINT || target.pathname !== wanted || target.search || target.hash || init.method !== "GET") throw Error("stage6-k1-bank-route-refused");
        report.bank_read_calls++; return originalFetch(url, init);
      };
      store = createHindsightGuidanceStore({ mode: "local-guidance", endpoint: ENDPOINT, banks: { [ALIAS]: BANK }, journal_directory: join(directory, "unused-journal"), bearer_token: token, allow_loopback_http: true, timeout_ms: 120_000 });
    } finally { globalThis.fetch = originalFetch; }
    history = await prepareK1ActualHistory({ reference: saved.reference, scope: SCOPE, verifier, read: (ref, signal) => store.read(ref, signal), binding: expected, experience_id: `${run}-import`, now: Date.now });
    report.history = history.summary;
    const context = { provider: "codex-local-8319", model: "gpt-6.1-sol", thinking: "max", sdk: "1.0.4", arm: "baseline", guidance_mode: "none", guidance_digest: null,
      harness_source_sha: c["harness-source-sha"], subject_source_sha: PAIR_SOURCE_SHA, subject_history_digest: PAIR_HISTORY_DIGEST, broker_digest: c["broker-pin"] };
    const bindings = { ...expected, harness_source_sha: c["harness-source-sha"], context_digest: null, artifact_digest: sha(await readFile(new URL(import.meta.url))) };
    const collectProvenance = async () => bindStage6Provenance({ sdk: matchSdkContract(await observeSdkInstallation(c.sdk), PUBLIC_1_0_4_CONTRACT), broker: await observeReadonlyBrokerMetadata({ profile_directory: c["profile-dir"], provider: context.provider, command, expected_command_sha256: c["broker-pin"] }), subject_source_sha: PAIR_SOURCE_SHA, history_digest: PAIR_HISTORY_DIGEST, bindings });
    const provenance = await collectProvenance();
    factory = createK1NativeFactory({ sdkRoot: c.sdk, profileDirectory: c["profile-dir"], brokerPin: c["broker-pin"], outputDirectory: directory });
    report.phase = "model-window";
    armTerminalWatchdog?.(directory);
    report.pilot = await runK1Pilot({ profileDirectory: c["profile-dir"], context, bindings, provenance, preparedHistory: history },
      { createSession: factory.createSession, collectProvenance, captureProfile: captureStage6Profile, checkSource: async () => { await sourceCheck(ROOT, c["harness-source-sha"]); await sourceCheck(c["subject-root"], PAIR_SOURCE_SHA); } });
    report.status = report.pilot.status; report.model_calls = report.pilot.receipt.pretransport_attempts; captured = report.model_calls;
    report.native = factory.snapshot();
    if (report.status === "measured" && report.native.request_contract_checks !== report.model_calls) {
      report.status = "unknown"; report.failure = "stage6-k1-request-envelope-unconfirmed";
    }
    await checkGuidanceServiceFingerprint(c["service-fingerprint"]);
    report.bank_read_calls++;
    const bankAfter = await readGuidanceBankPreflight(await fetch(`${ENDPOINT}/v1/default/banks/${BANK}/config`, { method: "GET", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), credentials: "omit", redirect: "error", cache: "no-store" }));
    if (bankBaseline.bank_state_sha256 !== bankAfter.bank_state_sha256) throw Error("stage6-k1-bank-state-drift");
    factory.assertSafe(JSON.stringify(report));
  } catch (e) {
    report.failure = safeFailure(e); report.status = "unknown";
    if (factory) report.native = factory.snapshot();
    report.model_calls = report.pilot?.receipt?.pretransport_attempts ?? (report.phase === "model-window" ? null : captured);
  }
  finally { history?.shutdown(); verifier?.shutdown(); }
  let safe = report;
  try { factory?.assertSafe(JSON.stringify(report)); }
  catch { safe = { schema: "stage6-k1-actual/1", status: "unknown", failure: "stage6-k1-unsafe-projection", model_calls: report.model_calls,
    bank_write_calls: 0, bank_read_calls: report.bank_read_calls, authorization: "none", executable: false }; }
  await writeFile(join(directory, "report.json"), JSON.stringify(safe, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return Object.freeze(safe);
}
if (isMain(import.meta.url)) {
  process.umask(0o077);
  const stdout = process.stdout.write.bind(process.stdout), stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true; process.stderr.write = () => true;
  let report;
  let terminalDeadline;
  armTerminalWatchdog = directory => {
    terminalDeadline = setTimeout(() => {
      const unknown = { schema: "stage6-k1-actual/1", status: "unknown", failure: "stage6-k1-actual-deadline", model_calls: null, authorization: "none", executable: false };
      const body = JSON.stringify(unknown) + "\n";
      writeFile(join(directory, "deadline-report.json"), body, { mode: 0o600, flag: "wx" })
        .catch(() => undefined).finally(() => { stdout(body); process.exit(1); });
    }, PAIR_TIMEOUT_MS + 5000);
  };
  try { report = await runK1Actual(parseK1ActualOptions(process.argv.slice(2))); }
  catch { report = { schema: "stage6-k1-actual/1", status: "unknown", failure: "stage6-k1-actual-unavailable", model_calls: null, authorization: "none", executable: false }; }
  clearTimeout(terminalDeadline);
  process.stdout.write = stdout; process.stderr.write = stderr;
  stdout(JSON.stringify(report, null, 2) + "\n"); process.exit(report.status === "measured" ? 0 : 1);
}
