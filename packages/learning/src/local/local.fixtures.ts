import { createLocalEvidenceVerifier, type LocalEvidenceConfig, type LocalObservation } from "@pi-vista/evidence/host";
import { type EvidenceBinding } from "@pi-vista/evidence";
import { LearningError, type ExperienceObservation } from "../contract.js";
import type { GuidanceReadback, GuidanceReceipt, HindsightGuidanceStore } from "../guidance/contract.js";
import { document, documentId, receipt, writeRequest } from "../guidance/data.js";
import { createLocalLearningLibrary } from "./index.js";

export const expected: EvidenceBinding = { run_id: "local-run", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "fixture-v1", env_fingerprint: "fixture-env" };
export const selected = { gate: "fixture-gate", test: "fixture-tests", guard: "fixture-guard" };
export const query = { repo: expected.repo, source_sha: expected.source_sha, policy_version: expected.policy_version, env_fingerprint: expected.env_fingerprint, task_type: "fixture-task" };
export const scope = "fixed-fixture-plan-v1";
export function observation(id = "local-example", run = expected.run_id): ExperienceObservation {
  return { ...expected, experience_id: id, run_id: run, task_type: "fixture-task", ts: 10_000,
    script: { task_type: "fixture-task", description: "inspect fixture metadata", preconditions: [], steps: ["inspect-fixture"], postconditions: [], known_failures: [], applicable_to: ["alternate-task"] },
    steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect fixture metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] };
}
export function fixture(timeout_ms = 1000) {
  let now = 10_000; const calls = { collect: 0, retain: 0, read: 0, query: 0, reconcile: 0 };
  const payloads: Record<string, any> = Object.fromEntries(["gate", "test", "guard"].map(kind => [kind, { schema: 1, scope, kind, producer: `fixture-${kind}`, ...expected,
    result_ref: `fixture-${kind}-result`, observed_at: 9900, expires_at: 15_000,
    details: kind === "gate" ? { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "fixture-build", outcome: "pass" }] } :
      kind === "test" ? { suites: [{ name: "fixture-cases", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] } :
        { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 } }]));
  const evidenceConfig: LocalEvidenceConfig = { mode: "local-host", scope, gate_checks: ["fixture-build"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64),
    test_suites: ["fixture-cases"], now: () => now, max_age_ms: 10_000, timeout_ms: 1000,
    sources: ["gate", "test", "guard"].map(kind => ({ subject: kind === "test" ? selected.test : selected[kind as "gate" | "guard"], producer: `fixture-${kind}`, kind: kind as LocalObservation["kind"],
      collect: async () => { calls.collect++; return payloads[kind]; } })) };
  const verifier = createLocalEvidenceVerifier(evidenceConfig); const docs = new Map<string, GuidanceReadback>();
  const state: { mode: string; retain?: HindsightGuidanceStore["retain"]; read?: HindsightGuidanceStore["read"]; query?: HindsightGuidanceStore["query"]; reconcile?: HindsightGuidanceStore["reconcile"]; lastSignal?: AbortSignal } = { mode: "normal" };
  const store: HindsightGuidanceStore = {
    async retain(bank, doc, signal) {
      calls.retain++; state.lastSignal = signal; if (state.retain) return state.retain(bank, doc, signal);
      const request = writeRequest(bank, doc); const r = receipt(request, "d".repeat(64)); const decoded = document(doc);
      docs.set(documentId(request, "d".repeat(64)), { ...r, ...decoded });
      if (state.mode === "lost-ack") throw Error("private retain body");
      return state.mode === "bad-ack" ? { ...r, content_digest: "e".repeat(64) } : r;
    },
    async read(ref, signal) {
      calls.read++; if (state.read) return state.read(ref, signal);
      const result = docs.get(ref.document_id); if (!result) throw Error("private missing original");
      return state.mode === "bad-read" ? { ...result, guidance: { ...result.guidance, current_verification: "verified" } } as any : result;
    },
    async query(bank, q, signal) {
      calls.query++; if (state.query) return state.query(bank, q, signal);
      return [...docs.values()].map(({ bank: alias, document_id }) => ({ bank: alias, document_id, current_verification: "not-checked" as const, authorization: "none" as const, executable: false as const })).slice(0, q.limit ?? 8);
    },
    async reconcile(bank, doc, signal) {
      calls.reconcile++; if (state.reconcile) return state.reconcile(bank, doc, signal);
      const id = documentId(writeRequest(bank, doc), "d".repeat(64));
      return { state: docs.get(id)?.document.content === doc.content ? "matched" : "not-confirmed", current_verification: "not-checked", authorization: "none", executable: false };
    },
  };
  const config = { mode: "local-learning" as const, scope, verifier, store, timeout_ms };
  const library = createLocalLearningLibrary(config);
  return { library, config, store, state, docs, calls, payloads, evidenceConfig, verifier,
    setNow: (n: number) => { now = n; }, proof: () => verifier.verify(expected, selected) };
}
export async function verified(f: ReturnType<typeof fixture>, id?: string) {
  const observed = f.library.observe(observation(id)); const candidate = f.library.nominate(observed);
  return f.library.verifyCandidate(candidate, await f.proof());
}
export async function persisted(f: ReturnType<typeof fixture>, id?: string) {
  const handle = await verified(f, id); const plan = f.library.prepareGuidance(handle, "fixture-alias");
  return { plan, handle: await f.library.commitGuidance(plan, { preview_digest: plan.preview_digest }) };
}
export const errorCode = (code: LearningError["code"]) => (e: unknown) => e instanceof LearningError && e.code === code;
export const reference = (r: GuidanceReceipt) => ({ bank: r.bank, document_id: r.document_id, current_verification: "not-checked" as const, authorization: "none" as const, executable: false as const });
