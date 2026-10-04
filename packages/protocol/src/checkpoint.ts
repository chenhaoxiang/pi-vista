/**
 * VistaCheckpoint — a verifiable snapshot of task state at a named step.
 *
 * Checkpoints let a new session (or a new model) resume from a known-good
 * point without replaying the entire history. They are the basis for
 * cross-session and cross-model recovery.
 *
 * REDACTION CONTRACT: Must not contain raw commands, filesystem paths,
 * credentials, or model inputs/outputs.
 */
export interface VistaCheckpoint {
  run_id: string;
  step_id: string;
  ts: number;

  // ── Task state (all redacted) ─────────────────────────────────────────
  /** Human-readable task goal (redacted). */
  task_goal: string;

  /** Step IDs that have been completed. */
  completed_steps: string[];

  /** Structured summary of current state (no raw paths or commands). */
  current_state: string;

  /** Step IDs still pending. */
  pending_steps: string[];

  // ── Verification binding ──────────────────────────────────────────────
  /** Git SHA at checkpoint time. */
  source_sha: string;

  /** Environment fingerprint hash. */
  env_fingerprint: string;

  /** Policy version active at checkpoint time. */
  policy_version: string;

  // ── Resumability ─────────────────────────────────────────────────────
  /** Check Function IDs that must pass before this checkpoint can be resumed. */
  check_fn_ids: string[];

  /** Whether this checkpoint is safe to resume from. */
  resumable: boolean;

  /**
   * Conditions that must be met before resuming.
   * Examples: ["source_sha_matches", "worktree_clean"]
   */
  resume_requires?: string[] | undefined;
}
