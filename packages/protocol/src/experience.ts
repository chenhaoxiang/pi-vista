import type { ArtifactRef } from "./artifact.js";
import type { VistaFailure } from "./failure.js";

/**
 * ExperienceStatus — the lifecycle state of an experience.
 *
 * observed  → candidate  → verified  → trusted
 *                       ↘ rejected
 *                       ↘ deprecated (was trusted, now superseded)
 */
export type ExperienceStatus =
  | "observed"      // recorded, not yet evaluated
  | "candidate"     // passed basic checks, pending full verification
  | "verified"      // gate + tests + guard all clean
  | "trusted"       // promoted to Hindsight, available for retrieval
  | "deprecated"    // was trusted, superseded by newer experience
  | "rejected";     // explicitly failed or unsafe

/**
 * VistaScript — high-level task skeleton (Script-level experience).
 *
 * Captures the WHAT and WHY of a task pattern, not the HOW.
 * Reusable across similar tasks even when details differ.
 *
 * Inspired by the script-level abstraction in Mem^p (2025).
 */
export interface VistaScript {
  task_type: string;
  description: string;

  /** Conditions that must hold before starting. */
  preconditions: string[];

  /** High-level steps in order (not raw commands). */
  steps: string[];

  /** What to check after completion. */
  postconditions: string[];

  /** Known failure modes and their mitigations. */
  known_failures: Array<{ symptom: string; mitigation: string }>;

  /** Task types this script applies to. */
  applicable_to: string[];
}

/**
 * VistaStep — fine-grained executable step (Step-level experience).
 *
 * Captures the specific tool call, arguments (redacted), result,
 * and check functions to validate before execution.
 *
 * Inspired by the step-level abstraction in Mem^p (2025).
 */
export interface VistaStep {
  step_id: string;
  tool: string;

  /**
   * Redacted action description (no raw commands or paths).
   * Example: "create worktree at standard location for task"
   */
  action_description: string;

  /** Check Functions that must pass before this step runs. */
  check_fn_ids: string[];

  /** Expected result classification. */
  expected_result: string;

  /** What to do on failure. */
  on_failure: "stop" | "retry_once" | "skip" | "escalate";

  /** Step IDs that must complete before this one. */
  depends_on: string[];
}

/**
 * ExperienceVerification — evidence that an experience is trustworthy.
 */
export interface ExperienceVerification {
  gate_passed: boolean;
  tests_passed: boolean;
  guard_clean: boolean;  // no A-layer events in the run

  laya_result?: "allow" | "abstain" | null | undefined;

  /** References to the receipts and CI results that back this verification. */
  receipt_refs: ArtifactRef[];

  verified_at: number;  // Unix ms
  verified_sha: string;
}

/**
 * VistaExperience — the core unit of reusable, verified execution knowledge.
 *
 * An experience combines a task pattern (Script-level) with specific
 * execution steps (Step-level), failure analysis, and verification evidence.
 * It is the unit that gets promoted to Hindsight.
 */
export interface VistaExperience {
  experience_id: string;
  run_id: string;          // source run
  task_type: string;
  ts: number;

  // ── Content ────────────────────────────────────────────────────────────
  /** High-level task skeleton. Reusable across similar tasks. */
  script?: VistaScript | undefined;

  /** Fine-grained steps. Used for exact replay. */
  steps?: VistaStep[] | undefined;

  /** Failure analysis from this run (if applicable). */
  failure_analysis?: VistaFailure | undefined;

  // ── Verification ───────────────────────────────────────────────────────
  verification?: ExperienceVerification | undefined;

  // ── Provenance ─────────────────────────────────────────────────────────
  source_sha: string;
  policy_version: string;
  env_fingerprint: string;

  /** Model that produced this run (for statistics only). */
  model_id?: string | undefined;

  // ── Lifecycle ──────────────────────────────────────────────────────────
  status: ExperienceStatus;

  /**
   * Hindsight document ID after promotion.
   * Present only when status is "trusted".
   */
  hindsight_doc_id?: string | undefined;

  superseded_by?: string | undefined;  // experience_id of newer experience
}
