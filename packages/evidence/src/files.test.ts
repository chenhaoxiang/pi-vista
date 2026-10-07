import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, link, mkdir, readFile, readdir, rename, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceVerifier, createEvidenceCheckRegistry, evidenceMessage } from "@pi-vista/evidence";
import { createReceiptFileSources, type ReceiptFileConfig } from "@pi-vista/evidence/files";
import { assertFixedSource, canonical, checkout, errorCode, expected, readGate, subjects, withFixture } from "./files.fixtures.js";

const refused = errorCode("unverified-evidence");
test("files addon: exact frozen detached envelope, fixed private source mapping and native promise", async () => withFixture(async f => {
  assert.ok(Object.isFrozen(f.sources)); f.sources.forEach(assertFixedSource);
  const pending = readGate(f); assert.ok(pending instanceof Promise);
  const envelope: any = await pending; assert.deepEqual(envelope, f.receipts.gate);
  assert.ok(Object.isFrozen(envelope)); assert.ok(Object.isFrozen(envelope.payload.details.checks[0]));
  assert.notEqual(envelope.payload, f.receipts.gate.payload);
  const before = await readFile(f.file("gate"));
  const config: any = f.config; config.root = path.join(f.root, "nonexistent"); config.sources[0].file_id = "missing"; config.sources[0].public_key = "changed";
  assert.deepEqual(await readGate(f), envelope); assert.deepEqual(await readFile(f.file("gate")), before);
  await writeFile(f.file("gate"), Buffer.concat([before, Buffer.from("\n")]));
  assert.deepEqual(await readGate(f), envelope, "one terminal LF only is permitted");
}));
test("files addon: three fresh sources, probes, binding/identity/current lifetime and safe new publication", async () => withFixture(async f => {
  const proof = await f.verifier.verify(expected, subjects);
  assert.equal(proof.authorization, "none"); assert.ok(f.verifier.isCurrent(proof, expected));
  for (const copy of [{ ...proof }, JSON.parse(JSON.stringify(proof))]) assert.equal(f.verifier.isCurrent(copy, expected), false);
  assert.equal(createEvidenceVerifier(f.verifierConfig).isCurrent(proof, expected), false);
  for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const)
    assert.equal(f.verifier.isCurrent(proof, { ...expected, [field]: field === "source_sha" ? "d".repeat(40) : "other" }), false);
  const registry = createEvidenceCheckRegistry(f.verifier);
  const report = await registry.run((["receipt_present", "test_passed", "custom:evidence/guard-clean"] as const).map((type, i) => ({
    check_id: `check-${i}`, type, params: { subject: Object.values(subjects)[i]!, ...expected }, on_fail: "STOP" as const,
  })));
  assert.equal(report.satisfied, true); assert.equal(report.verification, "predicate-only"); assert.equal(report.authorization, "none");
  assert.equal(f.verifier.isCurrent(report, expected), false);
  f.payloads.gate.receipt_ref = "new-published-ref"; await f.publish("gate");
  const replacement = path.join(f.root, "publication"); await writeFile(replacement, canonical(f.receipts.gate), { mode: 0o600 });
  await rename(replacement, f.file("gate"));
  await assert.rejects(f.verifier.revalidate(proof), refused);
  assert.equal((await f.verifier.verify(expected, subjects)).receipts[0]!.receipt_ref, "new-published-ref");
  // Offline isCurrent is identity/expiry only, never a revocation or file poll.
  assert.ok(f.verifier.isCurrent(proof, expected)); f.setNow(15_000);
  assert.equal(f.verifier.isCurrent(proof, expected), false); await assert.rejects(f.verifier.verify(expected, subjects), refused);
}));
for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`files addon: signed ${field} mismatch remains rejected by unchanged verifier`, async () => withFixture(async f => {
    f.payloads.gate[field] = field === "source_sha" ? "d".repeat(40) : "other"; await f.publish("gate");
    await assert.rejects(f.verifier.verify(expected, subjects), refused);
  }));
}
for (const name of ["wrong-key", "signature", "digest", "issuer", "kind", "expiry", "partial-guard", "blocked-guard", "failed-suite", "skipped-suite", "cancelled-suite", "owner-override", "failed-check", "missing-check", "missing-suite"] as const) {
  test(`files addon: ${name} cannot upgrade exact signed transport to proof`, async () => withFixture(async f => {
    if (name === "issuer") f.payloads.gate.issuer = "other-owner";
    if (name === "expiry") f.payloads.gate.expires_at = 9999;
    if (name === "partial-guard") f.payloads.guard.details.coverage = "partial";
    if (name === "blocked-guard") f.payloads.guard.details.blocked = 1;
    if (name === "owner-override") f.payloads.gate.details.verdict = "owner-override";
    if (name === "failed-check") f.payloads.gate.details.checks[0].outcome = "fail";
    if (name === "missing-check") f.payloads.gate.details.checks[0].name = "other-check";
    if (name === "missing-suite") f.payloads.test.details.suites[0].name = "other-suite";
    if (["failed-suite", "skipped-suite", "cancelled-suite"].includes(name)) {
      f.payloads.test.details.suites[0][name.split("-")[0]!] = 1; f.payloads.test.details.suites[0].passed = 1;
    }
    for (const kind of ["gate", "test", "guard"] as const) await f.publish(kind);
    if (name === "wrong-key") f.receipts.gate.signature = sign(null, Buffer.from(evidenceMessage(f.payloads.gate)), generateKeyPairSync("ed25519").privateKey).toString("base64");
    if (name === "signature") f.receipts.gate.signature = "A".repeat(86) + "==";
    if (name === "digest") f.receipts.gate.content_digest = "d".repeat(64);
    if (name === "kind") f.receipts.gate = f.receipts.test;
    await writeFile(f.file("gate"), canonical(f.receipts.gate));
    if (["wrong-key", "signature", "digest", "issuer", "kind"].includes(name)) assert.ok(await readGate(f), "transport parsing is NOT authentication");
    await assert.rejects(f.verifier.verify(expected, subjects), refused);
  }));
}
for (const [name, material] of [
  ["unsigned audit", { passed: true, verified: true, status: "passed", source_sha: expected.source_sha }],
  ["observation", { result: "ok", receipt_ref: "observation", verified: true }],
  ["candidate asset manifest", { status: "passed", asset_digest: "a".repeat(64), scope: "candidate" }],
  ["synthetic ticket", { status: "passed", ticket: "synthetic-ticket", test_passed: true, guard_clean: true }],
  ["App authentication checkrun", { status: "passed", authenticated: true, conclusion: "success" }],
] as const) test(`files addon: ${name} remains unsupported even when labelled passed`, async () => withFixture(async f => {
  await writeFile(f.file("gate"), canonical(material));
  await assert.rejects(readGate(f), refused); await assert.rejects(f.verifier.verify(expected, subjects), refused);
}));
for (const name of ["formatting", "duplicate", "BOM", "invalid-UTF8", "two-LF", "CRLF", "trailing", "multiple", "truncated", "unknown-envelope", "unknown-payload", "normalization", "uppercase-digest", "bad-signature", "zero-suite", "zero-guard"] as const) {
  test(`files addon: ${name} rejected without modifying the original file or normalizing authority`, async () => withFixture(async f => {
    let text = canonical(f.receipts.gate); let bytes: Buffer | undefined;
    if (name === "formatting") text = JSON.stringify(f.receipts.gate, null, 2);
    if (name === "duplicate") text = text.replace("{", `{"content_digest":"${f.receipts.gate.content_digest}",`);
    if (name === "BOM") bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    if (name === "invalid-UTF8") bytes = Buffer.concat([Buffer.from(text), Buffer.from([0xff])]);
    if (name === "two-LF") text += "\n\n";
    if (name === "CRLF") text += "\r\n";
    if (name === "trailing") text += "garbage";
    if (name === "multiple") text += text;
    if (name === "truncated") text = text.slice(0, -1);
    if (name === "unknown-envelope") text = canonical({ ...f.receipts.gate, verified: true });
    if (name === "unknown-payload") f.receipts.gate.payload.extra = "label";
    if (name === "normalization") f.receipts.gate.payload.source_sha = expected.source_sha.toUpperCase();
    if (name === "uppercase-digest") f.receipts.gate.content_digest = f.receipts.gate.content_digest.toUpperCase();
    if (name === "bad-signature") f.receipts.gate.signature = "not-a-signature";
    if (name === "zero-suite") { f.receipts.gate = f.receipts.test; f.receipts.gate.payload.details.suites[0].total = 0; f.receipts.gate.payload.details.suites[0].passed = 0; }
    if (name === "zero-guard") { f.receipts.gate = f.receipts.guard; f.receipts.gate.payload.details.event_count = 0; }
    if (["unknown-payload", "normalization", "uppercase-digest", "bad-signature", "zero-suite", "zero-guard"].includes(name)) text = canonical(f.receipts.gate);
    await writeFile(f.file("gate"), bytes ?? Buffer.from(text)); const before = await readFile(f.file("gate"));
    await assert.rejects(readGate(f), refused); assert.deepEqual(await readFile(f.file("gate")), before);
  }));
}
test("files addon: unsafe own-data config, descriptors, arrays, names and private/mixed/noncanonical pins reject without hooks", async () => withFixture(async f => {
  let called = 0; const evil = new Proxy({}, { get: () => { called++; }, ownKeys: () => { called++; return []; } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const source = f.config.sources[0]!; const privateKey = f.keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const invalid: unknown[] = [evil, revoked.proxy, null, Object.create(f.config), { ...f.config, extra: true }, { ...f.config, max_bytes: undefined },
    { ...f.config, root: "relative" }, { ...f.config, root: `${f.root}/` }, { ...f.config, root: `${f.root}/../other` }, { ...f.config, root: "/" },
    { ...f.config, max_bytes: 0 }, { ...f.config, max_bytes: 1_048_577 }, { ...f.config, timeout_ms: 0 }, { ...f.config, timeout_ms: 10_001 },
    { ...f.config, sources: [source, source] }, { ...f.config, sources: [source, { ...source, subject: "other", file_id: source.file_id.toUpperCase() }] },
    { ...f.config, sources: [evil] }, { ...f.config, sources: [] }, { ...f.config, sources: new Array(1) }, { ...f.config, sources: [undefined] },
    { ...f.config, sources: [{ ...source, file_id: "../outside" }] }, { ...f.config, sources: [{ ...source, subject: "wrapped_ghp_abcdefghijklmnop" }] },
    { ...f.config, sources: [{ ...source, public_key: privateKey }] }, { ...f.config, sources: [{ ...source, public_key: source.public_key + privateKey }] },
    { ...f.config, sources: [{ ...source, public_key: source.public_key.trim() }] },
    Object.defineProperty({ ...f.config }, "root", { get: () => { called++; return f.root; } }),
    { ...f.config, sources: [Object.defineProperty({ ...source }, "file_id", { get: () => { called++; return "gate"; } })] },
  ];
  for (const value of invalid) assert.throws(() => createReceiptFileSources(value as ReceiptFileConfig), errorCode("invalid-config"));
  assert.equal(called, 0);
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.sources[0]!.read(controller.signal), refused);
  for (const signal of [{}, evil, Object.defineProperty({}, "aborted", { get: () => { called++; return false; } })])
    await assert.rejects(f.sources[0]!.read(signal as AbortSignal), errorCode("invalid-input"));
  assert.equal(called, 0);
}));
for (const kind of ["symlink", "hardlink", "directory", "FIFO", "file-permissions", "root-permissions", "empty", "oversize", "root-symlink", "ancestor-symlink"] as const) {
  test(`files addon: native ${kind} refuses, no file repair or permission change`, async () => withFixture(async f => {
    if (kind === "symlink") { await rename(f.file("gate"), path.join(f.root, "other")); await symlink("other", f.file("gate")); }
    if (kind === "hardlink") await link(f.file("gate"), path.join(f.root, "other"));
    if (kind === "directory" || kind === "FIFO") {
      await unlink(f.file("gate"));
      if (kind === "directory") await mkdir(f.file("gate"));
      else { const result = spawnSync("/usr/bin/mkfifo", ["-m", "600", f.file("gate")], { shell: false, env: {}, timeout: 5000 }); assert.ifError(result.error); assert.equal(result.status, 0); }
    }
    if (kind === "file-permissions") await chmod(f.file("gate"), 0o640);
    if (kind === "root-permissions") await chmod(f.root, 0o750);
    if (kind === "empty" || kind === "oversize") await writeFile(f.file("gate"), kind === "empty" ? "" : "x".repeat(f.config.max_bytes + 1));
    if (kind === "root-symlink" || kind === "ancestor-symlink") {
      const actual = path.join(f.root, "actual"); await mkdir(actual, { mode: 0o700 }); await symlink("actual", path.join(f.root, "alias"));
      if (kind === "ancestor-symlink") await mkdir(path.join(actual, "nested"), { mode: 0o700 });
      const root = path.join(f.root, "alias", ...(kind === "ancestor-symlink" ? ["nested"] : []));
      await assert.rejects(createReceiptFileSources({ ...f.config, root })[0]!.read(new AbortController().signal), refused);
    } else await assert.rejects(readGate(f), refused);
    assert.ok((await readdir(f.root)).includes("gate.receipt.json"));
  }));
}
function child(mode: string, args: string[] = []) {
  const script = fileURLToPath(new URL("files-boundary.fixtures.js", import.meta.url));
  const result = spawnSync(process.execPath, [script, mode, ...args], { cwd: checkout, shell: false, env: {}, timeout: 15_000, encoding: "utf8", maxBuffer: 128 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); return JSON.parse(result.stdout);
}
test("files addon: real root graph isolation and import/factory no-I/O, no writes/discovery/network", () => {
  const result = child("isolation"); assert.equal(result.io, 0); assert.equal(result.root_isolated, true); assert.equal(result.writes, 0);
});
for (const mode of ["read", "error"]) test(`files addon: actual ${mode} uses only fixed configured paths and no writes/default discovery`, async () => withFixture(async f => {
  await writeFile(path.join(f.root, "config.json"), JSON.stringify(f.config), { mode: 0o600 });
  const result = child(mode, ["normal", path.join(f.root, "config.json")]);
  assert.equal(result.code, mode === "read" ? "matched" : "unverified-evidence");
  assert.equal(result.writes, 0); assert.equal(result.opened, result.closed);
}));
for (const phase of ["lstat-root", "root-open", "root-stat", "lstat-file", "file-open", "file-stat", "read", "final-root", "close"] as const) for (const mode of ["abort", "timeout"] as const) {
  test(`files addon: ${mode} after awaited ${phase} preflight closes descriptors before any subsequent I/O`, async () => withFixture(async f => {
    await writeFile(path.join(f.root, "config.json"), JSON.stringify(f.config), { mode: 0o600 });
    const result = child("cancel", [mode, phase, path.join(f.root, "config.json")]);
    assert.equal(result.code, mode === "abort" ? "unverified-evidence" : "evidence-timeout");
    assert.equal(result.afterCancellation, 0); assert.equal(result.opened, result.closed); assert.equal(result.writes, 0);
  }));
}
for (const mode of ["mutation", "rename", "root-rename", "file-mode", "root-mode", "foreign-owner", "partial", "growth", "socket-stat", "close-error"] as const) {
  test(`files addon: observed in-flight ${mode} refuses with fixed error and closes descriptors`, async () => withFixture(async f => {
    await writeFile(path.join(f.root, "config.json"), JSON.stringify(f.config), { mode: 0o600 });
    const result = child("race", [mode, path.join(f.root, "config.json")]); assert.equal(result.code, "unverified-evidence");
    assert.equal(result.opened, result.closed); assert.equal(result.writes, 0);
  }));
}
