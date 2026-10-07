import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { types } from "node:util";
import { CheckRegistry } from "@pi-vista/checks";
import {
  EvidenceError, own, list, label, sha, digest, integer, labels, freeze, canonical,
  binding, sameBinding, bounded, BINDING_KEYS, type EvidenceBinding,
} from "./data.js";
export { EvidenceError } from "./data.js";
export type { EvidenceBinding } from "./data.js";

export type EvidenceKind = "gate" | "test" | "guard";
export interface EvidenceSource {
  readonly subject: string;
  readonly issuer: string;
  readonly kind: EvidenceKind;
  /** Host-pinned Ed25519 public PEM. No private key is accepted. */
  readonly public_key: string;
  /** Explicit trusted host transport; no filesystem or network reader is installed. */
  readonly read: (signal: AbortSignal) => Promise<unknown>;
}
export interface EvidenceConfig {
  readonly sources: readonly EvidenceSource[];
  readonly gate_checks: readonly string[];
  readonly gate_version: string;
  readonly gate_config_digest: string;
  readonly test_suites: readonly string[];
  readonly now: () => number;
  readonly max_age_ms?: number;
  readonly timeout_ms?: number;
}
export interface EvidenceSubjects { readonly gate: string; readonly test: string; readonly guard: string; }
export interface ReceiptSummary {
  readonly kind: EvidenceKind; readonly issuer: string; readonly receipt_ref: string;
  readonly content_digest: string; readonly expires_at: number;
}
/** Only a handle minted by this verifier has provenance. Serialized/copied views do not. */
export interface VerifiedEvidence extends EvidenceBinding {
  readonly verification: "authority-bound";
  readonly authorization: "none";
  readonly verified_at: number;
  readonly receipts: readonly ReceiptSummary[];
}
export interface EvidenceVerifier {
  verify(expected: EvidenceBinding, subjects: EvidenceSubjects): Promise<VerifiedEvidence>;
  isCurrent(proof: unknown, expected: EvidenceBinding): boolean;
  /** Re-read sources; reject if any receipt digest differs from the reviewed proof. */
  revalidate(proof: VerifiedEvidence): Promise<VerifiedEvidence>;
}
interface Payload extends EvidenceBinding {
  readonly schema: 1; readonly kind: EvidenceKind; readonly issuer: string;
  readonly receipt_ref: string; readonly issued_at: number; readonly expires_at: number;
  readonly details: Readonly<Record<string, unknown>>;
}
interface Source extends Omit<EvidenceSource, "public_key"> { readonly key: KeyObject; }
interface ProofRecord { readonly expected: EvidenceBinding; readonly subjects: EvidenceSubjects; readonly payloads: readonly Payload[]; }
interface State {
  readonly sources: ReadonlyMap<string, Source>; readonly gates: readonly string[]; readonly suites: readonly string[];
  readonly now: () => number; readonly maxAge: number; readonly timeout: number;
  readonly gateVersion: string; readonly gateConfigDigest: string;
  readonly proofs: WeakMap<object, ProofRecord>;
}
const states = new WeakMap<object, State>();
const KINDS: readonly EvidenceKind[] = ["gate", "test", "guard"];
function kind(value: unknown): EvidenceKind {
  if (!KINDS.includes(value as EvidenceKind)) throw new EvidenceError("invalid-input"); return value as EvidenceKind;
}
function choices(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new EvidenceError("invalid-input"); return value;
}
function snapshotPayload(input: unknown): Payload {
  const v = own(input, ["schema", "kind", "issuer", ...BINDING_KEYS, "receipt_ref", "issued_at", "expires_at", "details"]);
  if (v.schema !== 1) throw new EvidenceError("invalid-input");
  const k = kind(v.kind);
  const b = binding(Object.fromEntries(BINDING_KEYS.map(key => [key, v[key]])));
  let details: Record<string, unknown>;
  if (k === "gate") {
    const d = own(v.details, ["verdict", "gate_version", "config_digest", "checks"]);
    const checks = list(d.checks).map(item => {
      const c = own(item, ["name", "outcome"]);
      return freeze({ name: label(c.name), outcome: choices(c.outcome, ["pass", "fail", "skipped", "pending"]) });
    });
    if (new Set(checks.map(c => c.name)).size !== checks.length) throw new EvidenceError("invalid-input");
    details = { verdict: choices(d.verdict, ["pass", "fail", "owner-override"]), gate_version: sha(d.gate_version),
      config_digest: digest(d.config_digest), checks: freeze(checks) };
  } else if (k === "test") {
    const d = own(v.details, ["suites"]);
    const suites = list(d.suites).map(item => {
      const c = own(item, ["name", "total", "passed", "failed", "skipped", "cancelled"]);
      const out = { name: label(c.name), total: integer(c.total, 1_000_000_000, 1), passed: integer(c.passed, 1_000_000_000),
        failed: integer(c.failed, 1_000_000_000), skipped: integer(c.skipped, 1_000_000_000), cancelled: integer(c.cancelled, 1_000_000_000) };
      if (out.passed + out.failed + out.skipped + out.cancelled !== out.total) throw new EvidenceError("invalid-input");
      return freeze(out);
    });
    if (new Set(suites.map(s => s.name)).size !== suites.length) throw new EvidenceError("invalid-input");
    details = { suites: freeze(suites) };
  } else {
    const d = own(v.details, ["coverage", "event_count", "blocked"]);
    details = { coverage: choices(d.coverage, ["complete", "partial"]), event_count: integer(d.event_count, 1_000_000_000, 1),
      blocked: integer(d.blocked, 1_000_000_000) };
    if ((details.blocked as number) > (details.event_count as number)) throw new EvidenceError("invalid-input");
  }
  const issued = integer(v.issued_at); const expires = integer(v.expires_at);
  if (expires <= issued) throw new EvidenceError("invalid-input");
  return freeze({ schema: 1, kind: k, issuer: label(v.issuer), ...b, receipt_ref: label(v.receipt_ref),
    issued_at: issued, expires_at: expires, details: freeze(details) });
}
/** Canonical v1 signing message. Owner signing remains outside this verifier. */
export function evidenceMessage(payload: unknown): string { return canonical(snapshotPayload(payload)); }
function subjects(input: unknown, state: State): EvidenceSubjects {
  const v = own(input, KINDS);
  const out = { gate: label(v.gate), test: label(v.test), guard: label(v.guard) };
  for (const k of KINDS) if (state.sources.get(out[k])?.kind !== k) throw new EvidenceError("unverified-evidence");
  return freeze(out);
}
function current(payload: Payload, state: State): boolean {
  const now = integer(state.now());
  return payload.issued_at <= now && now < payload.expires_at &&
    now - payload.issued_at <= state.maxAge && payload.expires_at - payload.issued_at <= state.maxAge;
}
function successful(p: Payload, state: State): boolean {
  const d = p.details;
  if (p.kind === "gate") {
    const checks = d.checks as readonly {name: string; outcome: string}[];
    return d.verdict === "pass" && d.gate_version === state.gateVersion && d.config_digest === state.gateConfigDigest && checks.every(c => c.outcome === "pass") &&
      state.gates.every(name => checks.some(c => c.name === name));
  }
  if (p.kind === "test") {
    const suites = d.suites as readonly {name: string; total: number; passed: number; failed: number; skipped: number; cancelled: number}[];
    return suites.every(s => s.passed === s.total && s.failed === 0 && s.skipped === 0 && s.cancelled === 0) &&
      state.suites.every(name => suites.some(s => s.name === name));
  }
  return d.coverage === "complete" && d.blocked === 0;
}
async function readReceipt(state: State, source: Source, expected: EvidenceBinding, signal?: AbortSignal): Promise<{payload: Payload; summary: ReceiptSummary}> {
  try {
    const raw = await bounded(source.read, state.timeout, signal);
    const v = own(raw, ["payload", "content_digest", "signature"]);
    const p = snapshotPayload(v.payload); const message = canonical(p);
    const hash = createHash("sha256").update(message).digest("hex");
    const declared = digest(v.content_digest);
    if (typeof v.signature !== "string" || v.signature.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/u.test(v.signature)) throw new EvidenceError("unverified-evidence");
    const signature = Buffer.from(v.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== v.signature || declared !== hash || p.kind !== source.kind ||
      p.issuer !== source.issuer || !sameBinding(p, expected) || !current(p, state) || !successful(p, state) ||
      !verifySignature(null, Buffer.from(message), source.key, signature)) throw new EvidenceError("unverified-evidence");
    return { payload: p, summary: freeze({ kind: p.kind, issuer: p.issuer, receipt_ref: p.receipt_ref, content_digest: hash, expires_at: p.expires_at }) };
  } catch { throw new EvidenceError("unverified-evidence"); }
}
export function createEvidenceVerifier(config: EvidenceConfig): EvidenceVerifier {
  let state: State;
  try {
    const c = own(config, ["sources", "gate_checks", "gate_version", "gate_config_digest", "test_suites", "now", "max_age_ms", "timeout_ms"], ["sources", "gate_checks", "gate_version", "gate_config_digest", "test_suites", "now"]);
    if (typeof c.now !== "function" || types.isProxy(c.now)) throw new EvidenceError("invalid-config");
    const sources = new Map<string, Source>();
    for (const input of list(c.sources, 64)) {
      const s = own(input, ["subject", "issuer", "kind", "public_key", "read"]);
      const subject = label(s.subject); const issuer = label(s.issuer); const k = kind(s.kind);
      if (sources.has(subject) || typeof s.public_key !== "string" || s.public_key.length > 4_096 ||
        !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/u.test(s.public_key) || typeof s.read !== "function" || types.isProxy(s.read)) throw new EvidenceError("invalid-config");
      const key = createPublicKey(s.public_key);
      if (key.type !== "public" || key.asymmetricKeyType !== "ed25519" ||
        key.export({ type: "spki", format: "pem" }).toString().trim() !== s.public_key.trim()) throw new EvidenceError("invalid-config");
      sources.set(subject, freeze({ subject, issuer, kind: k, key, read: s.read as EvidenceSource["read"] }));
    }
    state = { sources, gates: labels(c.gate_checks), suites: labels(c.test_suites), now: c.now as () => number,
      gateVersion: sha(c.gate_version), gateConfigDigest: digest(c.gate_config_digest),
      maxAge: integer(c.max_age_ms ?? 600_000, 86_400_000, 1), timeout: integer(c.timeout_ms ?? 1_000, 10_000, 1), proofs: new WeakMap() };
    integer(state.now());
  } catch { throw new EvidenceError("invalid-config"); }
  const verifier: EvidenceVerifier = freeze({
    async verify(expectedInput: EvidenceBinding, subjectsInput: EvidenceSubjects): Promise<VerifiedEvidence> {
      try {
        const expected = binding(expectedInput); const selected = subjects(subjectsInput, state);
        const payloads: Payload[] = []; const summaries: ReceiptSummary[] = [];
        for (const k of KINDS) {
          const result = await readReceipt(state, state.sources.get(selected[k])!, expected);
          payloads.push(result.payload); summaries.push(result.summary);
        }
        if (!payloads.every(p => current(p, state))) throw new EvidenceError("unverified-evidence");
        const proof: VerifiedEvidence = freeze({ ...expected, verification: "authority-bound", authorization: "none",
          verified_at: integer(state.now()), receipts: freeze(summaries) });
        state.proofs.set(proof, { expected, subjects: selected, payloads: freeze(payloads) });
        return proof;
      } catch { throw new EvidenceError("unverified-evidence"); }
    },
    isCurrent(proof: unknown, expectedInput: EvidenceBinding): boolean {
      try {
        if (proof === null || typeof proof !== "object") return false;
        const record = state.proofs.get(proof);
        return record !== undefined && sameBinding(record.expected, binding(expectedInput)) && record.payloads.every(p => current(p, state));
      } catch { return false; }
    },
    async revalidate(proof: VerifiedEvidence): Promise<VerifiedEvidence> {
      const record = state.proofs.get(proof);
      if (!record) throw new EvidenceError("unverified-evidence");
      const fresh = await verifier.verify(record.expected, record.subjects);
      if (!fresh.receipts.every((receipt, i) => receipt.content_digest === proof.receipts[i]?.content_digest)) throw new EvidenceError("unverified-evidence");
      return fresh;
    },
  });
  states.set(verifier, state); return verifier;
}

/** Only factory-minted verifier identities; useful at downstream trust boundaries. */
export function isEvidenceVerifier(value: unknown): value is EvidenceVerifier {
  return value !== null && typeof value === "object" && states.has(value);
}

/** Fresh registry. Boolean reports remain predicate-only and carry no proof capability. */
export function createEvidenceCheckRegistry(verifier: EvidenceVerifier): CheckRegistry {
  const state = states.get(verifier); if (!state) throw new EvidenceError("invalid-config");
  const registry = new CheckRegistry();
  for (const [type, k] of [["receipt_present", "gate"], ["test_passed", "test"], ["custom:evidence/guard-clean", "guard"]] as const) {
    registry.register(type, async invocation => {
      const p = own(invocation.definition.params, ["subject", ...BINDING_KEYS]);
      const source = state.sources.get(label(p.subject));
      if (!source || source.kind !== k) throw new EvidenceError("unverified-evidence");
      const expected = binding(Object.fromEntries(BINDING_KEYS.map(key => [key, p[key]])));
      await readReceipt(state, source, expected, invocation.signal); return true;
    });
  }
  return registry;
}
