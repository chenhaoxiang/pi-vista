import type { ArtifactRef } from "./artifact.js";

/**
 * VistaComponent — the system that emitted this event.
 * Use "custom:<name>" for project-specific components.
 */
export type VistaComponent =
  | "pi"
  | "guard"
  | "gate"
  | "laya"
  | "kev"
  | "test"
  | "browser"
  | "ci"
  | `custom:${string}`;

/**
 * VistaResult — the outcome of the action.
 */
export type VistaResult = "ok" | "blocked" | "failed" | "unknown" | "abstain";

/**
 * VistaEvent — the atomic unit of observation in pi-vista.
 *
 * Every component emits VistaEvents. A single run_id ties all events
 * from a task together across components.
 *
 * REDACTION CONTRACT: This interface must never carry raw shell commands,
 * absolute filesystem paths, usernames, credentials, tokens, or model
 * inputs/outputs. Use target_class and reason_code for machine-readable
 * classification instead.
 */
export interface VistaEvent {
  // ── Identity ──────────────────────────────────────────────────────────
  /** Global ID tying all events from one task together. */
  run_id: string;

  /** Pi session ID (from PI_SESSION_ID env). */
  session_id?: string | undefined;

  /** Cross-component trace ID for correlated sub-operations. */
  trace_id?: string | undefined;

  /** Step ID within this run. */
  step_id: string;

  /** Unix timestamp in milliseconds. */
  ts: number;

  // ── Source ────────────────────────────────────────────────────────────
  /** Component that emitted this event. */
  component: VistaComponent;

  /** Repository name (basename of the git root). */
  repo?: string | undefined;

  /** Git SHA at the time of the event. Required for promotion eligibility. */
  source_sha?: string | undefined;

  /** Worktree path hash (not the raw path). */
  worktree_id?: string | undefined;

  /** Branch name. */
  branch?: string | undefined;

  // ── Action ────────────────────────────────────────────────────────────
  /**
   * Action identifier. Convention: "component:category:detail"
   * Examples: "guard:A:block", "gate:ci_check", "pi:tool_call:bash"
   */
  action: string;

  /**
   * Redacted target class. Describes WHAT was targeted, not the raw value.
   * Examples: "tracked_file", "tmp_dir", "git_worktree", "remote_branch"
   */
  target_class?: string | undefined;

  /** Policy or rule version active at emit time. */
  policy_version?: string | undefined;

  // ── Result ────────────────────────────────────────────────────────────
  /** Outcome of the action. */
  result: VistaResult;

  /**
   * Decision layer for guard events: "governance", "A", "B", "C", "none".
   * Maps to workspace-guard's four-layer contract.
   */
  layer?: string | undefined;

  /**
   * Machine-readable reason code for blocked or failed results.
   * Must not contain raw commands, paths, or user data.
   * Examples: "unrecoverable_delete", "sha_mismatch", "ci_failed"
   */
  reason_code?: string | undefined;

  /** References to external artifacts produced or consumed by this event. */
  artifact_refs?: ArtifactRef[] | undefined;

  // ── Environment ───────────────────────────────────────────────────────
  /**
   * Hash of the execution environment fingerprint.
   * Must not contain sensitive values — hash them before including.
   */
  env_fingerprint?: string | undefined;

  /** Model identifier (for statistics only, not trust decisions). */
  model_id?: string | undefined;

  // ── Protocol ──────────────────────────────────────────────────────────
  /** pi-vista protocol version that produced this event. */
  vista_version?: string | undefined;
}
