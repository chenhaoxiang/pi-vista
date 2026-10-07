import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceVerifier, evidenceMessage, EvidenceError, type EvidenceBinding, type EvidenceKind } from "@pi-vista/evidence";
import { createReceiptFileSources, type ReceiptFileConfig } from "@pi-vista/evidence/files";

export const checkout = fileURLToPath(new URL("../../../", import.meta.url));
export const expected: EvidenceBinding = { run_id: "file-run", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1" };
export const subjects = { gate: "file-gate", test: "file-test", guard: "file-guard" };
export const kinds = ["gate", "test", "guard"] as const;
export function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export function errorCode(code: EvidenceError["code"]) {
  return (error: unknown) => error instanceof EvidenceError && error.code === code && error.message === code && error.stack === `EvidenceError: ${code}`;
}
export async function fixture() {
  await mkdir(path.join(checkout, "tmp"), { recursive: true });
  const created = await mkdtemp(path.join(checkout, "tmp/receipt-files-"));
  const root = await realpath(created); // Only our synthetic mkdtemp directory.
  const keys = generateKeyPairSync("ed25519"); let now = 10_000;
  const payloads: Record<EvidenceKind, any> = {
    gate: { schema: 1, kind: "gate", issuer: "file-owner", ...expected, receipt_ref: "gate-ref", issued_at: 9000, expires_at: 15_000,
      details: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "source-check", outcome: "pass" }] } },
    test: { schema: 1, kind: "test", issuer: "file-owner", ...expected, receipt_ref: "test-ref", issued_at: 9000, expires_at: 15_000,
      details: { suites: [{ name: "unit-suite", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0 }] } },
    guard: { schema: 1, kind: "guard", issuer: "file-owner", ...expected, receipt_ref: "guard-ref", issued_at: 9000, expires_at: 15_000,
      details: { coverage: "complete", event_count: 2, blocked: 0 } },
  };
  const config: ReceiptFileConfig = { root, max_bytes: 16_384, timeout_ms: 2000,
    sources: kinds.map(kind => ({ subject: subjects[kind], file_id: kind, issuer: "file-owner", kind,
      public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString() })) };
  const receipts: Record<EvidenceKind, any> = { gate: null, test: null, guard: null };
  const file = (kind: EvidenceKind) => path.join(root, `${kind}.receipt.json`);
  const publish = async (kind: EvidenceKind) => {
    const message = evidenceMessage(payloads[kind]);
    receipts[kind] = { payload: JSON.parse(message), content_digest: createHash("sha256").update(message).digest("hex"),
      signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
    await writeFile(file(kind), canonical(receipts[kind]), { mode: 0o600 });
  };
  for (const kind of kinds) await publish(kind);
  const sources = createReceiptFileSources(config);
  const verifierConfig = { sources, gate_checks: ["source-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64),
    test_suites: ["unit-suite"], now: () => now, max_age_ms: 10_000, timeout_ms: 3000 };
  return { root, config, keys, payloads, receipts, file, publish, sources, verifierConfig, verifier: createEvidenceVerifier(verifierConfig),
    setNow: (value: number) => { now = value; }, cleanup: () => rm(created, { recursive: true, force: true }) };
}
export async function withFixture(run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture(); try { await run(f); } finally { await f.cleanup(); }
}
export const readGate = (f: Awaited<ReturnType<typeof fixture>>) => f.sources[0]!.read(new AbortController().signal);
export function assertFixedSource(source: object): void {
  assert.deepEqual(Object.keys(source).sort(), ["issuer", "kind", "public_key", "read", "subject"]);
  assert.ok(Object.isFrozen(source));
}
