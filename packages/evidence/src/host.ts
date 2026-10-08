import { createHash } from "node:crypto";
import { types } from "node:util";
import { evidenceMessage, type EvidenceKind, type EvidenceSubjects } from "./index.js";
import {
  EvidenceError, own, list, label, sha, digest, integer, labels, freeze, canonical,
  binding, sameBinding, bounded, BINDING_KEYS, type EvidenceBinding,
} from "./data.js";

export interface LocalGateDetails {
  readonly verdict: "pass" | "fail" | "owner-override";
  readonly gate_version: string; readonly config_digest: string;
  readonly checks: readonly { readonly name: string; readonly outcome: "pass" | "fail" | "skipped" | "pending" }[];
}
export interface LocalTestDetails {
  readonly suites: readonly { readonly name: string; readonly total: number; readonly passed: number;
    readonly failed: number; readonly skipped: number; readonly cancelled: number; readonly todo: number }[];
}
export interface LocalGuardDetails {
  /** Complete only within the explicitly declared host scope, not an OS/Meta claim. */
  readonly coverage: "complete" | "partial"; readonly event_count: number;
  readonly blocked: number; readonly dropped: number;
}
export type LocalObservation = EvidenceBinding & {
  readonly schema: 1; readonly scope: string; readonly producer: string;
  readonly result_ref: string; readonly observed_at: number; readonly expires_at: number;
} & (
  { readonly kind: "gate"; readonly details: LocalGateDetails } |
  { readonly kind: "test"; readonly details: LocalTestDetails } |
  { readonly kind: "guard"; readonly details: LocalGuardDetails }
);
export interface LocalEvidenceSource {
  readonly subject: string; readonly producer: string; readonly kind: EvidenceKind;
  /** Explicit trusted host collection. JSON/model input must not configure this port. */
  readonly collect: (signal: AbortSignal) => Promise<unknown>;
}
export interface LocalEvidenceConfig {
  readonly mode: "local-host"; readonly scope: string;
  readonly sources: readonly LocalEvidenceSource[];
  readonly gate_checks: readonly string[]; readonly gate_version: string;
  readonly gate_config_digest: string; readonly test_suites: readonly string[];
  readonly now: () => number; readonly max_age_ms?: number; readonly timeout_ms?: number;
}
export interface LocalObservationSummary {
  readonly kind: EvidenceKind; readonly producer: string; readonly result_ref: string;
  /** Immutable-content comparison only; no signature or portable authenticity. */
  readonly observation_digest: string; readonly expires_at: number;
}
export interface LocalVerifiedEvidence extends EvidenceBinding {
  readonly verification: "local-host-process"; readonly trust_basis: "explicit-trusted-host";
  readonly scope: string; readonly portable: false; readonly authorization: "none";
  readonly executable: false; readonly verified_at: number;
  readonly observations: readonly LocalObservationSummary[];
}
export interface LocalEvidenceVerifier {
  verify(expected: EvidenceBinding, subjects: EvidenceSubjects): Promise<LocalVerifiedEvidence>;
  isCurrent(proof: unknown, expected: EvidenceBinding): boolean;
  /** Re-collect, compare exact digests, revoke old handle, then rotate on success. */
  revalidate(proof: LocalVerifiedEvidence): Promise<LocalVerifiedEvidence>;
  /** Abort outstanding collection and permanently retire all process-local handles. */
  shutdown(): void;
}
interface LocalProofRecord {
  readonly expected: EvidenceBinding; readonly subjects: EvidenceSubjects;
  readonly observations: readonly LocalObservation[]; readonly deadline: number;
}
interface State {
  readonly scope: string; readonly sources: ReadonlyMap<string, LocalEvidenceSource>;
  readonly gates: readonly string[]; readonly suites: readonly string[];
  readonly gateVersion: string; readonly gateConfig: string; readonly now: () => number;
  readonly age: number; readonly timeout: number; readonly proofs: WeakMap<object, LocalProofRecord>;
  readonly pending: Set<AbortController>;
  open: boolean; timeFault: boolean; highWater: number;
}
const states = new WeakMap<object, State>();
const KINDS: readonly EvidenceKind[] = ["gate", "test", "guard"];
function kind(value: unknown): EvidenceKind {
  if (!KINDS.includes(value as EvidenceKind)) throw new EvidenceError("invalid-input");
  return value as EvidenceKind;
}
function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child !== null && typeof child === "object") deepFreeze(child);
  return freeze(value);
}
function observation(input: unknown): LocalObservation {
  const v = own(input, ["schema", "scope", "kind", "producer", ...BINDING_KEYS, "result_ref", "observed_at", "expires_at", "details"]);
  const k = kind(v.kind); let details = v.details;
  if (k === "test") {
    const d = own(details, ["suites"]);
    details = { suites: list(d.suites).map(item => {
      const s = own(item, ["name", "total", "passed", "failed", "skipped", "cancelled", "todo"]);
      if (integer(s.todo, 1_000_000_000) !== 0) throw new EvidenceError("unverified-evidence");
      return Object.fromEntries(["name", "total", "passed", "failed", "skipped", "cancelled"].map(key => [key, s[key]]));
    }) };
  } else if (k === "guard") {
    const d = own(details, ["coverage", "event_count", "blocked", "dropped"]);
    if (integer(d.dropped, 1_000_000_000) !== 0) throw new EvidenceError("unverified-evidence");
    details = { coverage: d.coverage, event_count: d.event_count, blocked: d.blocked };
  }
  // Reuse the unchanged closed payload validator as DATA validation only. No receipt,
  // key, signature, signed factory registration or legacy normalization is created.
  const p = JSON.parse(evidenceMessage({ schema: v.schema, kind: k, issuer: v.producer,
    ...Object.fromEntries(BINDING_KEYS.map(key => [key, v[key]])), receipt_ref: v.result_ref,
    issued_at: v.observed_at, expires_at: v.expires_at, details })) as {
      schema: 1; kind: EvidenceKind; issuer: string; receipt_ref: string;
      issued_at: number; expires_at: number; details: Record<string, unknown>;
    } & EvidenceBinding;
  if (k === "test") p.details = { suites: (p.details.suites as Record<string, unknown>[]).map(s => ({ ...s, todo: 0 })) };
  if (k === "guard") p.details = { ...p.details, dropped: 0 };
  return deepFreeze({ schema: p.schema, scope: label(v.scope), kind: p.kind, producer: p.issuer,
    ...binding({ run_id: p.run_id, repo: p.repo, source_sha: p.source_sha, policy_version: p.policy_version, env_fingerprint: p.env_fingerprint }), result_ref: p.receipt_ref,
    observed_at: p.issued_at, expires_at: p.expires_at, details: p.details }) as unknown as LocalObservation;
}
function time(state: State): number {
  if (!state.open || state.timeFault) throw new EvidenceError("unverified-evidence");
  try {
    const n = integer(state.now());
    if (n < state.highWater) throw new EvidenceError("unverified-evidence");
    state.highWater = n; return n;
  } catch {
    state.timeFault = true;
    for (const controller of state.pending) controller.abort();
    throw new EvidenceError("unverified-evidence");
  }
}
function current(p: LocalObservation, state: State, now: number): boolean {
  return p.observed_at <= now && now < p.expires_at && now - p.observed_at <= state.age &&
    p.expires_at - p.observed_at <= state.age;
}
function successful(p: LocalObservation, state: State): boolean {
  if (p.kind === "gate") return p.details.verdict === "pass" && p.details.gate_version === state.gateVersion &&
    p.details.config_digest === state.gateConfig && p.details.checks.every(c => c.outcome === "pass") &&
    state.gates.every(name => p.details.checks.some(c => c.name === name));
  if (p.kind === "test") return p.details.suites.every(s => s.passed === s.total && s.failed === 0 && s.skipped === 0 && s.cancelled === 0 && s.todo === 0) &&
    state.suites.every(name => p.details.suites.some(s => s.name === name));
  return p.details.coverage === "complete" && p.details.blocked === 0 && p.details.dropped === 0;
}
function subjects(input: unknown, state: State): EvidenceSubjects {
  const v = own(input, KINDS); const selected = freeze({ gate: label(v.gate), test: label(v.test), guard: label(v.guard) });
  for (const k of KINDS) if (state.sources.get(selected[k])?.kind !== k) throw new EvidenceError("unverified-evidence");
  return selected;
}
function summary(p: LocalObservation): LocalObservationSummary {
  return freeze({ kind: p.kind, producer: p.producer, result_ref: p.result_ref,
    observation_digest: createHash("sha256").update(canonical(p)).digest("hex"), expires_at: p.expires_at });
}

/** Single-owner local trust, not a human authenticator or replacement signed verifier. */
export function createLocalEvidenceVerifier(config: LocalEvidenceConfig): LocalEvidenceVerifier {
  let state: State;
  try {
    const c = own(config, ["mode", "scope", "sources", "gate_checks", "gate_version", "gate_config_digest", "test_suites", "now", "max_age_ms", "timeout_ms"],
      ["mode", "scope", "sources", "gate_checks", "gate_version", "gate_config_digest", "test_suites", "now"]);
    if (c.mode !== "local-host" || typeof c.now !== "function" || types.isProxy(c.now)) throw new EvidenceError("invalid-config");
    const sources = new Map<string, LocalEvidenceSource>();
    for (const input of list(c.sources, 64)) {
      const s = own(input, ["subject", "producer", "kind", "collect"]); const subject = label(s.subject);
      if (sources.has(subject) || typeof s.collect !== "function" || types.isProxy(s.collect)) throw new EvidenceError("invalid-config");
      sources.set(subject, freeze({ subject, producer: label(s.producer), kind: kind(s.kind), collect: s.collect as LocalEvidenceSource["collect"] }));
    }
    state = { scope: label(c.scope), sources, gates: labels(c.gate_checks), suites: labels(c.test_suites),
      gateVersion: sha(c.gate_version), gateConfig: digest(c.gate_config_digest), now: c.now as () => number,
      age: integer(c.max_age_ms ?? 600_000, 86_400_000, 1), timeout: integer(c.timeout_ms ?? 1_000, 10_000, 1),
      proofs: new WeakMap(), pending: new Set(), open: true, timeFault: false, highWater: 0 };
    for (const k of KINDS) if (![...sources.values()].some(s => s.kind === k)) throw new EvidenceError("invalid-config");
    time(state);
  } catch { throw new EvidenceError("invalid-config"); }
  const verifier: LocalEvidenceVerifier = freeze({
    async verify(expectedInput: EvidenceBinding, subjectsInput: EvidenceSubjects): Promise<LocalVerifiedEvidence> {
      const controller = new AbortController(); state.pending.add(controller);
      try {
        const expected = binding(expectedInput); const selected = subjects(subjectsInput, state); time(state);
        const end = performance.now() + state.timeout; const observations: LocalObservation[] = [];
        for (const k of KINDS) {
          time(state); const source = state.sources.get(selected[k])!;
          const remaining = end - performance.now();
          if (remaining <= 0 || controller.signal.aborted) throw new EvidenceError("unverified-evidence");
          const raw = await bounded(source.collect, remaining, controller.signal);
          const p = observation(raw);
          if (p.kind !== k || p.producer !== source.producer || p.scope !== state.scope || !sameBinding(p, expected) ||
              !current(p, state, time(state)) || !successful(p, state)) throw new EvidenceError("unverified-evidence");
          observations.push(p);
        }
        const now = time(state);
        if (performance.now() >= end || controller.signal.aborted || !observations.every(p => current(p, state, now))) throw new EvidenceError("unverified-evidence");
        const lifetime = Math.min(...observations.map(p => Math.min(p.expires_at - now, state.age - (now - p.observed_at))));
        if (lifetime <= 0) throw new EvidenceError("unverified-evidence");
        const deadline = performance.now() + lifetime;
        const proof: LocalVerifiedEvidence = freeze({ ...expected, verification: "local-host-process", trust_basis: "explicit-trusted-host",
          scope: state.scope, portable: false, authorization: "none", executable: false, verified_at: now,
          observations: freeze(observations.map(summary)) });
        state.proofs.set(proof, { expected, subjects: selected, observations: freeze(observations), deadline });
        return proof;
      } catch { throw new EvidenceError("unverified-evidence"); }
      finally { state.pending.delete(controller); }
    },
    isCurrent(proof: unknown, expectedInput: EvidenceBinding): boolean {
      try {
        if (proof === null || typeof proof !== "object") return false;
        const record = state.proofs.get(proof);
        if (!record || !sameBinding(record.expected, binding(expectedInput))) return false;
        const valid = record.observations.every(p => current(p, state, time(state))) && performance.now() < record.deadline;
        if (!valid) state.proofs.delete(proof);
        return valid;
      } catch {
        if (proof !== null && typeof proof === "object") state.proofs.delete(proof);
        return false;
      }
    },
    async revalidate(proof: LocalVerifiedEvidence): Promise<LocalVerifiedEvidence> {
      const record = state.proofs.get(proof);
      if (!record) throw new EvidenceError("unverified-evidence");
      // Challenge is single-use: even a failed/replayed challenge cannot revive it.
      state.proofs.delete(proof);
      if (!state.open || state.timeFault || performance.now() >= record.deadline || !record.observations.every(p => current(p, state, time(state)))) throw new EvidenceError("unverified-evidence");
      const fresh = await verifier.verify(record.expected, record.subjects);
      if (!fresh.observations.every((s, i) => s.observation_digest === proof.observations[i]?.observation_digest)) {
        state.proofs.delete(fresh); throw new EvidenceError("unverified-evidence");
      }
      return fresh;
    },
    shutdown(): void {
      state.open = false;
      for (const controller of state.pending) controller.abort();
    },
  });
  states.set(verifier, state); return verifier;
}

/** Only this addon's factory identities; copied/signed verifiers are not admitted. */
export function isLocalEvidenceVerifier(value: unknown): value is LocalEvidenceVerifier {
  return value !== null && typeof value === "object" && states.has(value);
}
