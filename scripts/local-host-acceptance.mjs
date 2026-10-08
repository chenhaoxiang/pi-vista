import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify, types } from "node:util";
import { hasKnownCredential, isSafeSegment } from "@pi-vista/core";
import { ROOT, commandEnvironment, isMain, listFiles, publicEntrypoints, parseOptions, readJson } from "./release-utils.mjs";
import { validateCaseCounts } from "./run-tests.mjs";

const exec = promisify(execFile);
const SCOPE = "fixed-host-command-plan-v1";
const PLAN = Object.freeze(["source-contract", "evidence-native", "packed-consumer-contract"]);
const POLICY = "local-host-v1";
const hash = value => createHash("sha256").update(value).digest("hex");

export function localHostOptions(args) {
  const raw = parseOptions(args, ["source-sha", "namespace", "deadline-ms"], ["allow-local"]);
  delete raw.network;
  if (raw["allow-local"] !== true || typeof raw["source-sha"] !== "string" || !/^[a-f0-9]{40,64}$/u.test(raw["source-sha"]) ||
      ![40, 64].includes(raw["source-sha"].length) || typeof raw.namespace !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(raw.namespace) || !isSafeSegment(raw.namespace) || hasKnownCredential(raw.namespace) ||
      !/^[1-9][0-9]{0,6}$/u.test(raw["deadline-ms"] ?? ""))
    throw Error("local-host-explicit-options-required");
  const deadline = Number(raw["deadline-ms"]);
  if (deadline < 1_000 || deadline > 1_200_000) throw Error("local-host-deadline-refused");
  return Object.freeze({ allow_local: true, source_sha: raw["source-sha"], namespace: raw.namespace, deadline_ms: deadline });
}
function snapshotOptions(input) {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error("local-host-options-refused");
  const keys = ["allow_local", "source_sha", "namespace", "deadline_ms"];
  if (Reflect.ownKeys(input).length !== keys.length) throw Error("local-host-options-refused");
  const out = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !Object.hasOwn(d, "value")) throw Error("local-host-options-refused");
    out[key] = d.value;
  }
  if (out.allow_local !== true || typeof out.source_sha !== "string" || typeof out.namespace !== "string" || !Number.isSafeInteger(out.deadline_ms)) throw Error("local-host-options-refused");
  return localHostOptions(["--allow-local", `--source-sha=${out.source_sha}`, `--namespace=${out.namespace}`, `--deadline-ms=${out.deadline_ms}`]);
}

/** Fixed-plan guard: process admissions only, never a filesystem/syscall/Meta claim. */
export function createHostPlanLedger(plan) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 32 || plan.some(x => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(x)) ||
      new Set(plan).size !== plan.length) throw Error("local-host-plan-refused");
  const names = Object.freeze([...plan]); const admitted = new Set(); const settled = new Map(); let blocked = 0;
  return Object.freeze({
    admit(name) {
      if (!names.includes(name) || admitted.has(name)) { blocked++; throw Error("local-host-admission-refused"); }
      admitted.add(name);
    },
    settle(name, success) {
      if (!admitted.has(name) || settled.has(name) || typeof success !== "boolean") { blocked++; throw Error("local-host-settlement-refused"); }
      settled.set(name, success); if (!success) blocked++;
    },
    details() {
      const complete = admitted.size === names.length && settled.size === names.length;
      return Object.freeze({ coverage: complete ? "complete" : "partial", event_count: admitted.size + settled.size, blocked, dropped: 0 });
    },
  });
}

/** Reject forged stdout counts; accept only the exact test-owned native report. */
export function nativeSuite(report, files) {
  validateCaseCounts(report, files);
  const c = report.counts;
  if (c.skipped !== 0 || c.todo !== 0) throw Error("local-host-native-nonpass");
  return Object.freeze({ name: "evidence-native", total: c.tests, passed: c.passed, failed: c.failed,
    skipped: c.skipped, cancelled: c.cancelled, todo: c.todo });
}

/** Effectful opt-in only. Imported helpers never read host config or start processes. */
export async function localHostAcceptance(input) {
  const options = snapshotOptions(input); const started = performance.now();
  const end = started + options.deadline_ms;
  const remaining = () => {
    const value = Math.floor(end - performance.now());
    if (value <= 0) throw Error("local-host-deadline-exceeded");
    return value;
  };
  const environment = commandEnvironment();
  const metadata = args => exec("git", ["-C", ROOT, ...args], { cwd: ROOT, env: environment, shell: false,
    timeout: Math.min(30_000, remaining()), maxBuffer: 1024 * 1024 });
  // Only the fixed source repository and exact committed clean head are admitted.
  const head = (await metadata(["rev-parse", "HEAD"])).stdout.trim();
  if (head !== options.source_sha || (await metadata(["status", "--porcelain", "--untracked-files=normal"])).stdout.trim())
    throw Error("local-host-source-drift");
  let parent = ROOT;
  for (const part of ["tmp", "local-host-acceptance"]) {
    parent = path.join(parent, part); await mkdir(parent, { recursive: true, mode: 0o700 });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("local-host-output-root-refused");
  }
  const directory = await mkdtemp(path.join(parent, `${options.namespace}-`));
  const temp = path.join(directory, "process-tmp"); await mkdir(temp, { mode: 0o700 });
  const ledger = createHostPlanLedger(PLAN); let verifier;
  const report = { schema: 1, mode: "local-host", scope: SCOPE, source_sha: head,
    namespace: options.namespace, status: "failed", actualRun: "not-completed", node: process.version,
    authorization: "none", executable: false, defaultActivation: false,
    macIdentityAuthenticationImplemented: false, signedOwnerAcceptance: false,
    realBankReleaseAccepted: false, guardCoverage: "fixed host command admissions only" };
  const admitted = async (name, executable, args, extraEnv = {}) => {
    ledger.admit(name);
    try {
      const result = await exec(executable, args, { cwd: ROOT, env: { ...environment, ...extraEnv, TMPDIR: temp }, shell: false,
        timeout: remaining(), maxBuffer: 32 * 1024 * 1024, killSignal: "SIGKILL" });
      await writeFile(path.join(directory, `${name}.log`), `exit:0\n${result.stdout}\n${result.stderr}`, { flag: "wx", mode: 0o600 });
      ledger.settle(name, true); return result;
    } catch (error) {
      ledger.settle(name, false);
      // No arbitrary exception/command/config body is projected into the report.
      await writeFile(path.join(directory, `${name}.log`), `exit:${Number.isSafeInteger(error.code) ? error.code : "unknown"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`, { flag: "wx", mode: 0o600 });
      throw Error("local-host-command-failed");
    }
  };
  try {
    const source = await admitted(PLAN[0], process.execPath, [path.join(ROOT, "scripts/source-gate.mjs")]);
    const sourceLines = source.stdout.split(/\r?\n/u).filter(x => x.startsWith("Source evidence: "));
    if (sourceLines.length !== 1) throw Error("local-host-source-report-refused");
    const sourcePath = sourceLines[0].slice("Source evidence: ".length);
    const ownedRoot = path.join(ROOT, "tmp", "release-contract");
    if (path.dirname(sourcePath) !== ownedRoot || !/^source-[A-Za-z0-9_-]+$/u.test(path.basename(sourcePath))) throw Error("local-host-source-report-refused");
    const sourceReport = await readJson(path.join(sourcePath, "report.json"));
    if (sourceReport.status !== "passed" || sourceReport.network !== false || sourceReport.node !== process.version) throw Error("local-host-source-report-refused");
    // Source gate's original test runner deletes its counts after validating them.
    // Execute one declared evidence-native suite with the unchanged native reporter
    // and retain our own exact report. Do not treat source stdout totals as proof.
    const compiled = path.join(ROOT, "packages/evidence/dist-test");
    const files = (await listFiles(compiled)).filter(x => x.endsWith(".test.js")).map(x => path.join(compiled, x));
    if (!files.length) throw Error("local-host-native-files-refused");
    const countsPath = path.join(directory, "native-counts.json");
    await admitted(PLAN[1], process.execPath, ["--test", `--test-reporter=${path.join(ROOT, "scripts/test-count-reporter.mjs")}`, ...files],
      { PI_VISTA_TEST_COUNT_FILE: countsPath, PI_VISTA_TEST_FILES: JSON.stringify(files) });
    const suite = nativeSuite(await readJson(countsPath), files);
    const consumer = await admitted(PLAN[2], process.execPath, [path.join(ROOT, "scripts/packed-consumer.mjs")]);
    const consumerLines = consumer.stdout.split(/\r?\n/u).filter(x => x.startsWith("Packed-consumer evidence: "));
    if (consumerLines.length !== 1) throw Error("local-host-consumer-report-refused");
    const consumerPath = consumerLines[0].slice("Packed-consumer evidence: ".length);
    if (path.dirname(consumerPath) !== ownedRoot || !/^consumer-[A-Za-z0-9_-]+$/u.test(path.basename(consumerPath))) throw Error("local-host-consumer-report-refused");
    const consumerReport = await readJson(path.join(consumerPath, "report.json"));
    if (consumerReport.status !== "passed" || consumerReport.network !== false || consumerReport.node !== process.version) throw Error("local-host-consumer-report-refused");
    if ((await metadata(["rev-parse", "HEAD"])).stdout.trim() !== head ||
        (await metadata(["status", "--porcelain", "--untracked-files=normal"])).stdout.trim()) throw Error("local-host-source-drift");
    remaining();
    const configDigest = hash(JSON.stringify({ scope: SCOPE, plan: PLAN, policy: POLICY, native: suite.name }));
    const expected = Object.freeze({ run_id: path.basename(directory), repo: "pi-vista", source_sha: head,
      policy_version: POLICY, env_fingerprint: hash(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, scope: SCOPE })) });
    const now = Date.now();
    const observations = Object.freeze(Object.fromEntries(["gate", "test", "guard"].map(kind => [kind, {
      schema: 1, scope: SCOPE, kind, producer: `local-host-${kind}`, ...expected,
      result_ref: `${options.namespace}-${kind}`, observed_at: now, expires_at: now + 60_000,
      details: kind === "gate" ? { verdict: "pass", gate_version: head, config_digest: configDigest,
        checks: [{ name: PLAN[0], outcome: "pass" }, { name: PLAN[2], outcome: "pass" }, { name: "source-identity", outcome: "pass" }] } :
        kind === "test" ? { suites: [suite] } : ledger.details(),
    }])));
    const { createLocalEvidenceVerifier, isLocalEvidenceVerifier } = await import("@pi-vista/evidence/host");
    const { isEvidenceVerifier } = await import("@pi-vista/evidence");
    verifier = createLocalEvidenceVerifier({ mode: "local-host", scope: SCOPE,
      sources: ["gate", "test", "guard"].map(kind => ({ subject: kind, kind, producer: `local-host-${kind}`, collect: async () => observations[kind] })),
      gate_checks: [PLAN[0], PLAN[2], "source-identity"], gate_version: head, gate_config_digest: configDigest,
      test_suites: [suite.name], now: Date.now, max_age_ms: 60_000, timeout_ms: 1_000 });
    const selected = { gate: "gate", test: "test", guard: "guard" };
    const proof = await verifier.verify(expected, selected);
    assert.ok(isLocalEvidenceVerifier(verifier) && !isEvidenceVerifier(verifier));
    assert.ok(verifier.isCurrent(proof, expected));
    assert.equal(verifier.isCurrent(JSON.parse(JSON.stringify(proof)), expected), false);
    const rotated = await verifier.revalidate(proof);
    assert.equal(verifier.isCurrent(proof, expected), false); assert.ok(verifier.isCurrent(rotated, expected));
    verifier.shutdown(); assert.equal(verifier.isCurrent(rotated, expected), false);
    remaining();
    Object.assign(report, { status: "passed", actualRun: "completed", expected, sourceReport: path.relative(ROOT, sourcePath),
      consumerReport: path.relative(ROOT, consumerPath), nativeSuite: suite, guard: ledger.details(),
      publicExport: "@pi-vista/evidence/host", exports: consumerReport.exports.length,
      packages: consumerReport.packages.length, processProof: proof,
      currentVerificationAfterShutdown: "not-current", copiedProofAccepted: false,
      exactRevalidationRotatesHandle: true, realSigningKeyAccessRequested: false, realModelBankCallsRequested: false });
  } catch (error) {
    report.failure = typeof error?.message === "string" && /^local-host-[a-z-]+$/u.test(error.message) ? error.message : "local-host-acceptance-failed";
    throw Error(report.failure);
  } finally {
    verifier?.shutdown(); report.elapsed_ms = Math.ceil(performance.now() - started);
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  return directory;
}

if (isMain(import.meta.url)) {
  try {
    const options = localHostOptions(process.argv.slice(2));
    console.log(`Local host evidence: ${await localHostAcceptance(options)}`);
  } catch (error) {
    console.error(typeof error?.message === "string" && /^local-host-[a-z-]+$/u.test(error.message) ? error.message : "local-host-acceptance-failed");
    process.exitCode = 1;
  }
}
