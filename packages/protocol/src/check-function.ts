/**
 * CheckFunctionType — the set of built-in environment checks.
 *
 * Custom checks use the "custom:<id>" form.
 */
export type CheckFunctionType =
  | "path_not_exists"
  | "path_exists"
  | "sha_matches"
  | "branch_not_exists"
  | "branch_exists"
  | "worktree_clean"
  | "file_contains"
  | "env_matches"
  | "receipt_present"
  | "test_passed"
  | `custom:${string}`;

/**
 * CheckFunctionOnFail — what to do when a check fails.
 *
 * - STOP: halt execution and report environment mismatch
 * - WARN: continue but flag for human review
 * - REPAIR: resolve the opaque repair_action_id through trusted policy, then
 *   re-check; STOP if still failing
 */
export type CheckFunctionOnFail = "STOP" | "WARN" | "REPAIR";

/**
 * VistaCheckFunction — an executable environment assertion.
 *
 * Check Functions are attached to experiences and checkpoints. Before
 * a replay or experience reuse proceeds, all bound check functions are
 * executed in order. Failure stops execution before any side effects occur.
 *
 * Inspired by the "check function" mechanism in AgentRR (IPADS/SJTU, 2025).
 *
 * Params support {repo}, {task}, {branch}, {sha} placeholders which are
 * resolved at runtime from the current execution context.
 */
export interface VistaCheckFunction {
  check_id: string;
  type: CheckFunctionType;

  /** Runtime parameters. Values may contain {placeholder} tokens. */
  params: Record<string, string>;

  on_fail: CheckFunctionOnFail;

  /**
   * Opaque policy-registry key to resolve when on_fail is "REPAIR".
   * This is an identifier only, never shell text or a command template.
   * Only a trusted policy registry may resolve and execute the corresponding
   * approved action.
   */
  repair_action_id?: string | undefined;

  /** Human-readable description of what this check verifies. */
  description?: string | undefined;
}
