/**
 * VistaFailure — structured analysis of a failed execution step.
 *
 * Failures are first-class data in pi-vista. A run that ends in failure
 * is just as valuable as a successful one — it records what went wrong,
 * what was tried, and what fixed it (or didn't).
 *
 * Inspired by the closed-loop failure analysis in EvolveR (2025).
 *
 * REDACTION CONTRACT: Must not contain raw commands, filesystem paths,
 * credentials, or model inputs/outputs.
 */
export interface VistaFailure {
  failure_id: string;
  run_id: string;
  step_id: string;
  ts: number;

  // ── Classification ────────────────────────────────────────────────────
  /**
   * Stage where the failure occurred.
   * Examples: "worktree_create", "test_run", "gate_check", "guard_check"
   */
  stage: string;

  /**
   * Failure type — machine-readable classification.
   * Examples: "guard_block", "test_failed", "gate_blocked",
   *           "path_conflict", "sha_mismatch", "env_mismatch"
   */
  failure_type: string;

  /**
   * Reason code from the failing component (no raw data).
   * Examples: "unrecoverable_delete", "ci_red", "review_missing"
   */
  reason_code: string;

  // ── Analysis ──────────────────────────────────────────────────────────
  /**
   * Root cause description (written by model or human after analysis).
   * Must be redacted before promotion.
   */
  root_cause?: string | undefined;

  /** Whether this failure is recoverable by the agent without human help. */
  recoverable?: boolean | undefined;

  // ── Resolution ────────────────────────────────────────────────────────
  /** Description of the fix that was applied. */
  fix_applied?: string | undefined;

  fix_outcome?: "resolved" | "partial" | "failed" | undefined;

  /**
   * Suggested policy or rule update to prevent recurrence.
   * Written into Hindsight as a Correction when the fix is confirmed.
   */
  policy_update?: string | undefined;
}
