import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const NAMESPACE = "pi-agent-canary";
export const TOOLS = Object.freeze(["canary_alpha", "canary_beta", "canary_parallel", "canary_wait"]);
export const RAW = Object.freeze(["ARGUMENT_BODY_CANARY", "OUTPUT_BODY_CANARY", "PROMPT_BODY_CANARY", "MODEL_BODY_CANARY", "sk_synthetic_canary_key_only", "X-Synthetic-Canary-Header", "https://synthetic.invalid/canary", "/private/synthetic-canary"]);
export const BODY = Object.freeze({ alpha: `ALPHA_FIXTURE ${RAW.slice(1).join(" ")}`, beta: `BETA_FIXTURE ${RAW.slice(1).join(" ")}` });
const codes = new Set(["invalid-config", "live-required", "unsafe-path", "private-file-required", "credential-refused", "credential-write-forbidden", "config-command-refused", "fixture-refused", "fixture-aborted", "deadline", "round-budget", "model-drift", "assertion-failed", "external-failure"]);
const failures = new WeakMap();
export class CanaryError extends Error {
  constructor(code) { super(codes.has(code) ? code : "external-failure"); failures.set(this, this.message); }
}
export function failureCode(error) { return (typeof error === "object" && error !== null ? failures.get(error) : undefined) ?? "external-failure"; }
export function requireCanary(value, code = "assertion-failed") { if (!value) throw new CanaryError(code); }
export function ownedFailureSite(error) {
  if (!failures.has(error)) return undefined;
  const sites = [...(error.stack ?? "").matchAll(/scripts\/(pi-agent-canary(?:-support)?\.mjs):(\d+):\d+/g)];
  const match = sites.find(site => site[1] === "pi-agent-canary.mjs") ?? sites[0];
  return match ? { file: match[1], line: Number(match[2]) } : undefined;
}
export function providerFailureCategory(value) {
  if (typeof value !== "string") return "unspecified";
  if (/abort|cancelled|canceled/i.test(value)) return "cancelled";
  if (/stream disconnected|response\.completed|stream closed|stream error|connection reset/i.test(value)) return "stream-disconnected";
  if (/401|403|unauthori[sz]ed|invalid api key/i.test(value)) return "authentication";
  if (/429|rate.?limit|quota|insufficient/i.test(value)) return "quota";
  if (/timeout|timed out|ETIMEDOUT/i.test(value)) return "timeout";
  if (/tool.?call|call.?id|function.?call|invalid.{0,30}(message|input|payload)|400|invalid_request/i.test(value)) return "request-contract";
  if (/500|502|503|overloaded|temporarily unavailable/i.test(value)) return "provider-unavailable";
  return "unclassified-provider-error";
}
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const label = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !hasKnownCredential(value) && !/^(?:sk[-_]|gh[pousr]_|github_pat_)/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);

export function parseCanaryOptions(args) {
  const options = {}, seen = new Set();
  const values = ["sdk", "profile-dir", "provider", "model", "thinking", "output-root", "test-namespace", "source-sha", "max-model-rounds", "deadline-ms"];
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
    requireCanary(match && !seen.has(match[1]), "invalid-config");
    const [, name, value] = match; seen.add(name);
    if (name === "allow-live" && value === undefined) options[name] = true;
    else { requireCanary((values.includes(name) || name === "readonly-broker-pin") && value !== undefined, "invalid-config"); options[name] = value; }
  }
  // Refuse before even inspecting a supplied SDK or profile. There is no preflight fallback.
  requireCanary(options["allow-live"] === true, "live-required");
  requireCanary(values.every(name => seen.has(name)), "invalid-config");
  if (options["readonly-broker-pin"] !== undefined) requireCanary(/^[a-f0-9]{64}$/.test(options["readonly-broker-pin"]), "invalid-config");
  for (const name of ["sdk", "profile-dir", "output-root"]) requireCanary(path.isAbsolute(options[name]) && !options[name].includes("\0") && path.normalize(options[name]) === options[name], "invalid-config");
  requireCanary(label(options.provider) && label(options.model) && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(options.thinking), "invalid-config");
  requireCanary(options["test-namespace"] === NAMESPACE && options["output-root"] === path.join(ROOT, "tmp", NAMESPACE), "unsafe-path");
  requireCanary(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(options["source-sha"]), "invalid-config");
  for (const [name, min, max] of [["max-model-rounds", 1, 32], ["deadline-ms", 1000, 1200000]]) {
    requireCanary(/^[1-9][0-9]*$/.test(options[name]), "invalid-config"); options[name] = Number(options[name]);
    requireCanary(Number.isSafeInteger(options[name]) && options[name] >= min && options[name] <= max, "invalid-config");
  }
  return Object.freeze(options);
}

export async function realDirectory(directory, privateOnly = false) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = await lstat(current);
    requireCanary(stat.isDirectory() && !stat.isSymbolicLink(), "unsafe-path");
  }
  const stat = await lstat(directory);
  if (privateOnly) requireCanary(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "private-file-required");
  return directory;
}
export async function privateRead(file) {
  await realDirectory(path.dirname(file));
  const stat = await lstat(file);
  requireCanary(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size <= 1048576, "private-file-required");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat(); requireCanary(opened.ino === stat.ino && opened.dev === stat.dev && opened.size <= 1048576, "unsafe-path");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}
export async function profileSnapshot(directory) {
  await realDirectory(directory, true);
  const snapshot = {};
  for (const name of [".", "auth.json", "models.json", "settings.json", "models-store.json"]) {
    let stat;
    try { stat = await lstat(path.join(directory, name)); }
    catch (error) { if (error?.code === "ENOENT" && ["settings.json", "models-store.json"].includes(name)) { snapshot[name] = null; continue; } throw new CanaryError("private-file-required"); }
    requireCanary(!stat.isSymbolicLink() && (name === "." ? stat.isDirectory() : stat.isFile()), "private-file-required");
    snapshot[name] = [stat.dev, stat.ino, stat.size, stat.mode, stat.uid, stat.mtimeMs, stat.ctimeMs];
  }
  return snapshot;
}
export function profileComparison(before, after) {
  const changed = Object.keys(before).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
  // Directory size/times may change because unrelated live sessions add files; do not attribute that to this trial.
  const rootIdentityUnchanged = [0, 1, 3, 4].every(index => before["."][index] === after["."][index]);
  return { metadataUnchanged: changed.length === 0, protectedFilesUnchanged: changed.every(name => name === ".") && rootIdentityUnchanged,
    changedEntries: changed, directoryDriftAttribution: changed.includes(".") ? "unknown-concurrent-host" : "not-observed" };
}
export function forbidConfigCommands(value) {
  if (typeof value === "string") requireCanary(!value.trimStart().startsWith("!"), "config-command-refused");
  else if (value && typeof value === "object") for (const item of Object.values(value)) forbidConfigCommands(item);
}
export async function verifyReadonlyBroker(config, provider, expectedDigest, profileDirectory) {
  const selected = config?.providers?.[provider]; const key = selected?.apiKey;
  requireCanary(typeof key === "string" && key.startsWith("!") && hash(key.slice(1)) === expectedDigest, "config-command-refused");
  // Explicitly pinned single-file reader only. No shell expansion/control/arguments or source-profile changes.
  const match = /^cat +(\/[A-Za-z0-9._/-]+)$/.exec(key.slice(1));
  requireCanary(match && path.isAbsolute(match[1]) && path.normalize(match[1]) === match[1] && match[1].startsWith(`${profileDirectory}${path.sep}`), "config-command-refused");
  await realDirectory(path.dirname(match[1]), true); const stat = await lstat(match[1]);
  requireCanary(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size > 0 && stat.size <= 4096, "private-file-required");
  // Only selected provider/model auth is requested; every other selected command source remains forbidden.
  forbidConfigCommands({ ...selected, apiKey: "pinned-readonly-broker" });
  const target = match[1];
  const capture = async () => {
    const current = await lstat(target);
    return [current.dev, current.ino, current.size, current.mode, current.uid, current.mtimeMs, current.ctimeMs];
  };
  return { before: await capture(), capture }; // Private closure only; target/key content never enters the report.
}
export function readonlyCredentials(provider, readAuth, allowSdkBroker = false) {
  let selectedKey; const secrets = new Set(); const counters = { reads: 0, blockedWrites: 0 };
  const forbidden = async () => { counters.blockedWrites++; throw new CanaryError("credential-write-forbidden"); };
  const store = {
    async read(id, { signal } = {}) {
      if (id !== provider) return undefined;
      requireCanary(!signal?.aborted, "credential-refused"); counters.reads++;
      let body; try { body = JSON.parse(await readAuth()); } catch { throw new CanaryError("credential-refused"); }
      const credential = Object.hasOwn(body ?? {}, provider) ? body[provider] : undefined;
      if (credential === undefined && allowSdkBroker) return undefined;
      requireCanary(credential?.type === "api_key" && typeof credential.key === "string" && credential.key.trim().length > 0 && !/^[!$]/.test(credential.key.trimStart()), "credential-refused");
      requireCanary(Object.keys(credential).every(key => ["type", "key", "env"].includes(key)), "credential-refused");
      requireCanary(selectedKey === undefined || selectedKey === credential.key, "credential-refused"); selectedKey = credential.key; secrets.add(selectedKey);
      if (credential.env !== undefined) {
        requireCanary(credential.env !== null && typeof credential.env === "object" && !Array.isArray(credential.env), "credential-refused");
        for (const item of Object.values(credential.env)) { requireCanary(typeof item === "string" && !/^[!$]/.test(item.trimStart()), "credential-refused"); secrets.add(item); }
      }
      return credential;
    },
    async list() { return []; }, modify: forbidden, delete: forbidden,
  };
  return { store, counters, assertAuth(auth) {
    const key = auth?.auth?.apiKey;
    if (allowSdkBroker && selectedKey === undefined) { requireCanary(typeof key === "string" && key.trim().length > 0, "credential-refused"); selectedKey = key; secrets.add(key); }
    requireCanary(selectedKey !== undefined && key === selectedKey, "credential-refused");
  }, assertAbsent(text) { assertAbsent(text, [...secrets]); } };
}
export function memoryCatalog() {
  const entries = new Map(); const counters = { reads: 0, writes: 0, deletes: 0 };
  return { counters, store: {
    async read(id) { counters.reads++; return entries.get(id); },
    async write(id, entry) { counters.writes++; entries.set(id, entry); },
    async delete(id) { counters.deletes++; entries.delete(id); },
  } };
}
export function createBudget(options, now = () => performance.now()) {
  const deadline = now() + options["deadline-ms"]; let attempts = 0;
  const remaining = () => { const ms = deadline - now(); requireCanary(ms > 0, "deadline"); return ms; };
  return { remaining, get attempts() { return attempts; },
    take(model, thinking) {
      remaining(); requireCanary(model.provider === options.provider && model.id === options.model && thinking === options.thinking, "model-drift");
      requireCanary(attempts < options["max-model-rounds"], "round-budget"); attempts++;
    },
    async wait(promise, maximum = Infinity) {
      let timer; const ms = Math.min(remaining(), maximum);
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new CanaryError("deadline")), ms); })]); }
      finally { clearTimeout(timer); }
    },
  };
}
export function constrainStream(session, budget, requestGuard) {
  const stream = session.agent.streamFunction;
  requireCanary(typeof stream === "function");
  // Public Agent.streamFunction: bound the request BEFORE the SDK/provider stream is invoked.
  // Awaited extension errors are fail-open and cannot enforce a round budget.
  let lastSignal;
  session.agent.streamFunction = (model, context, options) => {
    const thinking = options?.reasoning ?? "off"; budget.take(model, thinking); lastSignal = options?.signal;
    if (!requestGuard) return stream(model, context, options);
    return stream(model, context, { ...options, onPayload: async (payload, effectiveModel) => {
      const changed = await options?.onPayload?.(payload, effectiveModel);
      const final = changed ?? payload; requestGuard(final, effectiveModel, context, thinking); return final;
    } });
  };
  return { requestSignalAborted: () => lastSignal?.aborted === true };
}
export async function createTrial(outputRoot) {
  await realDirectory(path.dirname(outputRoot));
  try { await mkdir(outputRoot, { mode: 0o700 }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
  await realDirectory(outputRoot, true);
  const directory = await mkdtemp(path.join(outputRoot, "trial-"));
  for (const name of ["agent", "workspace", "observations"]) await mkdir(path.join(directory, name), { mode: 0o700 });
  for (const name of ["alpha", "beta"]) await writeFile(path.join(directory, "workspace", `${name}.txt`), BODY[name], { mode: 0o600, flag: "wx" });
  return directory;
}
export async function fixtureRead(directory, name, signal) {
  requireCanary(["alpha", "beta"].includes(name), "fixture-refused");
  requireCanary(!signal?.aborted, "fixture-aborted"); await realDirectory(directory, true);
  const file = path.join(directory, `${name}.txt`); const body = await privateRead(file);
  requireCanary(!signal?.aborted, "fixture-aborted"); requireCanary(body === BODY[name], "fixture-refused"); return body;
}
export function fixtureParameters(fixture) {
  return { type: "object", properties: { fixture: { type: "string", enum: [fixture] }, privacy: { type: "string", enum: [RAW[0]] } }, required: ["fixture", "privacy"], additionalProperties: false };
}
export function validateFixtureArguments(params, fixture) {
  requireCanary(params !== null && typeof params === "object" && !types.isProxy(params) && [Object.prototype, null].includes(Object.getPrototypeOf(params)), "fixture-refused");
  const descriptors = Object.getOwnPropertyDescriptors(params);
  requireCanary(Reflect.ownKeys(descriptors).length === 2 && ["fixture", "privacy"].every(key => descriptors[key] && Object.hasOwn(descriptors[key], "value")), "fixture-refused");
  requireCanary(descriptors.fixture.value === fixture && descriptors.privacy.value === RAW[0], "fixture-refused");
}
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export async function abortable(promise, signal) {
  requireCanary(!signal?.aborted, "fixture-aborted"); let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(new CanaryError("fixture-aborted")); signal?.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal?.removeEventListener("abort", abort); }
}
export function createFixtureTools(directory) {
  const returned = new Map(), inputs = new Map(); let activeReads = 0, maximumReads = 0;
  const waiting = { started: deferred(), active: false, signalReleased: false }; let pair;
  const result = (id, text) => { const value = { content: [{ type: "text", text }], details: undefined }; returned.set(id, JSON.stringify(value)); return value; };
  const definition = (name, fixture, execute, exposure = "direct") => ({ name, label: name, description: `Fixed synthetic ${fixture} fixture only. Supply fixture=${fixture} and privacy=${RAW[0]}.`, exposure, executionMode: "parallel", parameters: fixtureParameters(fixture),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(id, params, signal, update, ctx) { validateFixtureArguments(params, fixture); requireCanary(inputs.size < 32 && !inputs.has(id), "fixture-refused"); inputs.set(id, JSON.stringify(params)); requireCanary(!signal?.aborted, "fixture-aborted"); return execute(id, signal, ctx); },
  });
  const read = name => definition(`canary_${name}`, name, async (id, signal) => {
    activeReads++; maximumReads = Math.max(maximumReads, activeReads);
    try {
      if (pair) { pair.count++; if (pair.count === 2) pair.ready.resolve(); await abortable(pair.ready.promise, signal); }
      await delay(name === "alpha" ? 60 : 20, undefined, { signal }); return result(id, await fixtureRead(directory, name, signal));
    } finally { activeReads--; }
  });
  const tools = [read("alpha"), read("beta"), definition("canary_parallel", "pair", async (id, signal, ctx) => {
    requireCanary(!pair && JSON.stringify(ctx.tools.map(tool => tool.name).sort()) === JSON.stringify(["canary_alpha", "canary_beta"]));
    pair = { count: 0, ready: deferred() };
    try {
      const outcomes = await Promise.all(["alpha", "beta"].map(name => ctx.executeTool(`canary_${name}`, { fixture: name, privacy: RAW[0] }, { signal })));
      requireCanary(outcomes.every((outcome, i) => !outcome.isError && outcome.result?.content?.[0]?.text === BODY[["alpha", "beta"][i]]));
      return result(id, outcomes.map(outcome => outcome.result.content[0].text).join("\n"));
    } finally { pair = undefined; }
  }, "model-only"), definition("canary_wait", "wait", async (_id, signal) => {
    requireCanary(signal !== undefined, "fixture-refused"); waiting.active = true;
    const abort = () => { waiting.signalReleased = true; };
    signal.addEventListener("abort", abort, { once: true });
    try { waiting.started.resolve(); await abortable(new Promise(() => {}), signal); }
    finally { signal.removeEventListener("abort", abort); waiting.active = false; }
  }, "model-only")];
  return { tools, returned, inputs, waiting, get maximumReads() { return maximumReads; } };
}
export function createFaultPort() {
  const held = []; const counts = { reject: 0, hang: 0, lateRejection: 0, released: 0 }; let sequence = 0;
  return { counts, async call() {
    const mode = sequence++ % 3;
    if (mode === 0) { counts.reject++; throw new Error(RAW[1]); }
    const work = deferred(); held.push({ work, mode }); if (mode === 1) counts.hang++; else counts.lateRejection++;
    return work.promise;
  }, release() { for (const { work, mode } of held.splice(0)) { counts.released++; if (mode === 1) work.resolve(); else work.reject(new Error(RAW[1])); } } };
}
export function assertAbsent(text, forbidden = []) {
  requireCanary(typeof text === "string" && ![...RAW, ...forbidden.filter(value => typeof value === "string" && value.length > 0)].some(value => text.includes(value) || text.includes(JSON.stringify(value).slice(1, -1))));
}
export async function privateEvidenceFiles(directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name), stat = await lstat(file);
    requireCanary(!stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "unsafe-path");
    if (stat.isDirectory()) files.push(...await privateEvidenceFiles(file));
    else { requireCanary(stat.isFile(), "unsafe-path"); files.push({ file, text: await readFile(file, "utf8") }); }
  }
  return files;
}
export async function sdkPin(directory, node = process.versions.node) {
  const [major, minor] = node.split(".").map(Number);
  requireCanary(major > 22 || (major === 22 && minor >= 19), "invalid-config");
  const root = await realpath(directory); const manifestBytes = await readFile(path.join(root, "package.json")); const manifest = JSON.parse(manifestBytes);
  requireCanary(manifest.name === "@earendil-works/pi-coding-agent" && manifest.version === "1.0.4" && manifest.exports?.["."]?.import === "./dist/index.js", "invalid-config");
  const entry = path.join(root, "dist/index.js");
  return { entry, version: manifest.version, manifestSha256: hash(manifestBytes), entrySha256: hash(await readFile(entry)) };
}
