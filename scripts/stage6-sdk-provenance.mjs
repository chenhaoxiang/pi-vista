import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, sep } from "node:path";
import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";

// Explicit readonly metadata seam, not a loader, proof, admission, budget or permission.
// Importing performs no I/O; SDK public files and broker metadata are read only on call.
export const STAGE6_SDK_PROVENANCE_SCHEMA = "pi-sdk-provenance/1";
export const STAGE6_BINDING_SCHEMA = "stage6-provenance/1";
export const STAGE6_SDK_PROVENANCE_ERROR_CODES = Object.freeze([
  "stage6-sdk-installation-refused", "stage6-sdk-contract-refused", "stage6-sdk-broker-refused", "stage6-sdk-binding-refused",
]);
export const STAGE6_SDK_PROVENANCE_REASON_CODES = Object.freeze([
  "sdk-contract-match", "sdk-name-mismatch", "sdk-version-mismatch", "sdk-export-mismatch", "sdk-engine-mismatch",
  "sdk-manifest-mismatch", "sdk-entry-mismatch", "broker-command-match", "broker-command-mismatch",
]);
const PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const ENTRY = "./dist/index.js";
const ENGINE = ">=22.19.0";
const HEX = /^[a-f0-9]{64}$/u;
const SOURCE_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u;
const STAT_KEYS = ["dev", "ino", "mode", "uid", "nlink", "size", "mtimeMs", "ctimeMs"];
const CONTRACT_KEYS = ["contract_id", "package_name", "version", "export_entry", "node_engine", "manifest_sha256", "entry_sha256"];
const SDK_KEYS = ["schema", "package_name", "version", "export_entry", "node_engine", "manifest_sha256", "entry_sha256", "identity_sha256", "verification", "coverage", "dependency_closure", "authorization", "executable"];
const MATCH_KEYS = ["schema", "observed", "expected", "matched", "reason_code", "observed_digest", "expected_digest", "verification", "authorization", "executable"];
const BROKER_INPUT_KEYS = ["profile_directory", "provider", "command", "expected_command_sha256"];
const BROKER_KEYS = ["schema", "provider", "matched", "reason_code", "command_sha256", "expected_command_sha256", "target_path_sha256", "target_metadata_sha256", "verification", "credential_bytes_read", "authorization", "executable"];
const BINDING_KEYS = ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint", "harness_source_sha", "context_digest", "artifact_digest"];
const COMMON = Object.freeze({ verification: "metadata-only", authorization: "none", executable: false });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function refused() { throw Error("invalid-metadata"); }
function own(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refused();
  const out = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(value, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refused();
    out[key] = p.value;
  }
  return out;
}
// JSON manifests contain additional public metadata; snapshot just the required fields.
function fields(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refused();
  const out = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(value, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refused();
    out[key] = p.value;
  }
  return out;
}
function label(value) {
  if (typeof value !== "string" || !LABEL.test(value) || hasKnownCredential(value) ||
      ["__proto__", "constructor", "prototype"].includes(value)) refused();
  return value;
}
function hash(value, source = false) { if (typeof value !== "string" || !(source ? SOURCE_SHA : HEX).test(value)) refused(); return value; }
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function common(value) {
  if (value.verification !== "metadata-only" || value.authorization !== "none" || value.executable !== false) refused();
}
function absolute(value) {
  if (typeof value !== "string" || !isAbsolute(value) || value === parse(value).root || normalize(value) !== value || /[\x00-\x1f\x7f]/u.test(value)) refused();
  return value;
}
async function directories(directory) {
  let current = parse(directory).root;
  for (const part of directory.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part); const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refused();
  }
  return lstat(directory);
}
const sameStat = (a, b) => STAT_KEYS.every(key => a[key] === b[key]);
async function publicBytes(file, max) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > max) refused();
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await fd.stat(); if (!sameStat(before, first)) refused();
    // Read at most max+1, even if a writer grows the opened file after its stat.
    const buffer = Buffer.alloc(max + 1); let length = 0;
    while (length < buffer.length) {
      const read = await fd.read(buffer, length, buffer.length - length, length);
      if (read.bytesRead === 0) break; length += read.bytesRead;
    }
    const after = await fd.stat(), named = await lstat(file);
    if (length > max || length !== first.size || !sameStat(first, after) || !sameStat(after, named)) refused();
    return buffer.subarray(0, length);
  } finally { await fd.close(); }
}
function contract(input) {
  const v = own(input, CONTRACT_KEYS); label(v.contract_id);
  if (v.package_name !== PACKAGE_NAME || typeof v.version !== "string" || !VERSION.test(v.version) ||
      v.export_entry !== ENTRY || v.node_engine !== ENGINE) refused();
  hash(v.manifest_sha256); hash(v.entry_sha256); return Object.freeze({ ...v });
}

// public1.0.4 is the old Stage6 sdkPin/measurement contract. Fork snapshots are
// independent public-file comparisons, NOT accepted replacements or vendor attestations.
export const PUBLIC_1_0_4_CONTRACT = contract({ contract_id: "public-1.0.4", package_name: PACKAGE_NAME, version: "1.0.4",
  export_entry: ENTRY, node_engine: ENGINE, manifest_sha256: "248decde30021109984def7ddc8f7bf4caf21ef04910a1303ab19604206c1bd5",
  entry_sha256: "5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30" });
export const HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT = contract({ contract_id: "historical-fork-1.0.4-fork.1", package_name: PACKAGE_NAME, version: "1.0.4-fork.1",
  export_entry: ENTRY, node_engine: ENGINE, manifest_sha256: "6fa584d6ed0dc9c2cbfdf8981a87b713ed23f687f7da958d96512b4cdaac470b",
  entry_sha256: "5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30" });
export const OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT = contract({ contract_id: "observed-installed-1.1.0-fork.1", package_name: PACKAGE_NAME, version: "1.1.0-fork.1",
  export_entry: ENTRY, node_engine: ENGINE, manifest_sha256: "e4a5852edf1f61aa55ed0162d0137f769cf0ecc8a1169add7fa6c981a910af22",
  entry_sha256: "5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30" });
export const STAGE6_SDK_CONTRACT_MATRIX = Object.freeze({ public_1_0_4: PUBLIC_1_0_4_CONTRACT,
  historical_fork_1_0_4_fork_1: HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT,
  observed_installed_fork_1_1_0_fork_1: OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT });
function sdkSnapshot(input) {
  const v = own(input, SDK_KEYS); common(v);
  if (v.schema !== STAGE6_SDK_PROVENANCE_SCHEMA || v.package_name !== PACKAGE_NAME || typeof v.version !== "string" || !VERSION.test(v.version) ||
      v.export_entry !== ENTRY || v.node_engine !== ENGINE || v.coverage !== "manifest-and-public-entry" || v.dependency_closure !== "not-observed") refused();
  hash(v.manifest_sha256); hash(v.entry_sha256); hash(v.identity_sha256);
  const { identity_sha256, ...rest } = v;
  if (sha256(canonical(rest)) !== identity_sha256) refused();
  return Object.freeze({ ...v });
}
/** No SDK import/evaluation/registry/profile access, only package.json and fixed public entry. */
export async function observeSdkInstallation(rootInput) {
  try {
    const root = absolute(rootInput); const before = await directories(root);
    const distBefore = await directories(join(root, "dist"));
    const manifestBytes = await publicBytes(join(root, "package.json"), 65_536);
    const entryBytes = await publicBytes(join(root, "dist", "index.js"), 1_048_576);
    const manifest = fields(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)), ["name", "version", "exports", "engines"]);
    const engines = fields(manifest.engines, ["node"]), exported = fields(fields(manifest.exports, ["."])["."], ["import"]);
    if (manifest.name !== PACKAGE_NAME || typeof manifest.version !== "string" || !VERSION.test(manifest.version) || exported.import !== ENTRY || engines.node !== ENGINE) refused();
    const after = await directories(root), distAfter = await directories(join(root, "dist"));
    if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode || before.uid !== after.uid ||
        distBefore.dev !== distAfter.dev || distBefore.ino !== distAfter.ino || distBefore.mode !== distAfter.mode || distBefore.uid !== distAfter.uid) refused();
    const core = { schema: STAGE6_SDK_PROVENANCE_SCHEMA, package_name: manifest.name, version: manifest.version, export_entry: ENTRY,
      node_engine: ENGINE, manifest_sha256: sha256(manifestBytes), entry_sha256: sha256(entryBytes), coverage: "manifest-and-public-entry",
      dependency_closure: "not-observed", ...COMMON };
    return sdkSnapshot({ ...core, identity_sha256: sha256(canonical(core)) });
  } catch { throw Error("stage6-sdk-installation-refused"); }
}
export function sdkIdentityDigest(observed) {
  try { return sdkSnapshot(observed).identity_sha256; } catch { throw Error("stage6-sdk-contract-refused"); }
}
export function matchSdkContract(observedInput, expectedInput) {
  try {
    const observed = sdkSnapshot(observedInput), expected = contract(expectedInput);
    const comparisons = [["package_name", "sdk-name-mismatch"], ["version", "sdk-version-mismatch"], ["export_entry", "sdk-export-mismatch"],
      ["node_engine", "sdk-engine-mismatch"], ["manifest_sha256", "sdk-manifest-mismatch"], ["entry_sha256", "sdk-entry-mismatch"]];
    const failed = comparisons.find(([key]) => observed[key] !== expected[key]);
    return Object.freeze({ schema: "pi-sdk-contract-match/1", observed, expected, matched: !failed, reason_code: failed?.[1] ?? "sdk-contract-match",
      observed_digest: observed.identity_sha256, expected_digest: sha256(canonical(expected)), ...COMMON });
  } catch { throw Error("stage6-sdk-contract-refused"); }
}
export function validateSdkContractMatch(input) {
  try {
    const v = own(input, MATCH_KEYS); common(v);
    if (v.schema !== "pi-sdk-contract-match/1" || typeof v.matched !== "boolean" || typeof v.reason_code !== "string" ||
        !STAGE6_SDK_PROVENANCE_REASON_CODES.includes(v.reason_code) || typeof v.observed_digest !== "string" ||
        typeof v.expected_digest !== "string") refused();
    const fresh = matchSdkContract(v.observed, v.expected);
    if (v.schema !== fresh.schema || v.matched !== fresh.matched || v.reason_code !== fresh.reason_code ||
        v.observed_digest !== fresh.observed_digest || v.expected_digest !== fresh.expected_digest ||
        v.verification !== fresh.verification || v.authorization !== fresh.authorization || v.executable !== fresh.executable) refused();
    return fresh;
  } catch { throw Error("stage6-sdk-contract-refused"); }
}
function brokerSnapshot(input) {
  const v = own(input, BROKER_KEYS); common(v); label(v.provider); hash(v.command_sha256); hash(v.expected_command_sha256);
  const matched = v.command_sha256 === v.expected_command_sha256;
  if (v.schema !== "readonly-broker-provenance/1" || v.credential_bytes_read !== false || v.matched !== matched ||
      v.reason_code !== (matched ? "broker-command-match" : "broker-command-mismatch")) refused();
  if (matched) { hash(v.target_path_sha256); hash(v.target_metadata_sha256); }
  else if (v.target_path_sha256 !== null || v.target_metadata_sha256 !== null) refused();
  return Object.freeze({ ...v });
}
/** Closed explicit command metadata. No shell execution or credential-content read. */
export async function observeReadonlyBrokerMetadata(input) {
  try {
    const v = own(input, BROKER_INPUT_KEYS), root = absolute(v.profile_directory), provider = label(v.provider);
    hash(v.expected_command_sha256);
    if (typeof v.command !== "string" || v.command.length < 1 || v.command.length > 4096) refused();
    const command = v.command.startsWith("!") ? v.command.slice(1) : v.command;
    const match = /^cat +(\/[A-Za-z0-9._/-]+)$/u.exec(command); if (!match) refused();
    const path = absolute(match[1]), rel = relative(root, path);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) refused();
    const commandSha = sha256(command), matched = commandSha === v.expected_command_sha256;
    const core = { schema: "readonly-broker-provenance/1", provider, matched,
      reason_code: matched ? "broker-command-match" : "broker-command-mismatch", command_sha256: commandSha,
      expected_command_sha256: v.expected_command_sha256, target_path_sha256: null, target_metadata_sha256: null, credential_bytes_read: false, ...COMMON };
    // A nonmatching pin does not inspect the named target or the profile.
    if (!matched) return brokerSnapshot(core);
    const rootStat = await directories(root), parent = await directories(dirname(path));
    if (typeof process.getuid !== "function" || rootStat.uid !== process.getuid() || (rootStat.mode & 0o7777) !== 0o700 ||
        parent.uid !== process.getuid() || (parent.mode & 0o7777) !== 0o700) refused();
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() || (before.mode & 0o7777) !== 0o600 ||
        before.nlink !== 1 || before.size < 1 || before.size > 4096) refused();
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const first = await fd.stat(), named = await lstat(path); // No fd.read/readFile call.
      const rootAfter = await directories(root), parentAfter = await directories(dirname(path));
      if (!sameStat(before, first) || !sameStat(first, named) || rootAfter.dev !== rootStat.dev || rootAfter.ino !== rootStat.ino ||
          rootAfter.mode !== rootStat.mode || rootAfter.uid !== rootStat.uid || parentAfter.dev !== parent.dev || parentAfter.ino !== parent.ino ||
          parentAfter.mode !== parent.mode || parentAfter.uid !== parent.uid) refused();
      const metadata = Object.fromEntries(STAT_KEYS.map(key => [key, first[key]]));
      return brokerSnapshot({ ...core, target_path_sha256: sha256(path), target_metadata_sha256: sha256(canonical(metadata)) });
    } finally { await fd.close(); }
  } catch { throw Error("stage6-sdk-broker-refused"); }
}
export function validateReadonlyBrokerMetadata(input) {
  try { return brokerSnapshot(input); } catch { throw Error("stage6-sdk-broker-refused"); }
}
/** Serializable metadata only. Copies never restore LOCAL/evidence factory handles. */
export function bindStage6Provenance(input) {
  try {
    const v = own(input, ["sdk", "broker", "subject_source_sha", "history_digest", "bindings"]);
    const sdk = validateSdkContractMatch(v.sdk), broker = validateReadonlyBrokerMetadata(v.broker);
    const b = own(v.bindings, BINDING_KEYS), subject = hash(v.subject_source_sha, true);
    hash(v.history_digest); hash(b.source_sha, true); hash(b.harness_source_sha, true); hash(b.artifact_digest);
    if (b.source_sha !== subject) refused();
    label(b.run_id); label(b.repo); label(b.policy_version); label(b.env_fingerprint);
    if (b.context_digest !== null) hash(b.context_digest);
    return Object.freeze({ schema: STAGE6_BINDING_SCHEMA, sdk, broker, subject_source_sha: subject, history_digest: v.history_digest,
      bindings: Object.freeze({ ...b }), ...COMMON });
  } catch { throw Error("stage6-sdk-binding-refused"); }
}
export function validateStage6Provenance(input) {
  try {
    const v = own(input, ["schema", "sdk", "broker", "subject_source_sha", "history_digest", "bindings", "verification", "authorization", "executable"]);
    common(v); if (v.schema !== STAGE6_BINDING_SCHEMA) refused();
    return bindStage6Provenance(Object.fromEntries(["sdk", "broker", "subject_source_sha", "history_digest", "bindings"].map(key => [key, v[key]])));
  } catch { throw Error("stage6-sdk-binding-refused"); }
}
