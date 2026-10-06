export const CLI_VERSION = "0.1.0";
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const NESTED_LIMIT = 10;
export const STATS_LIMIT = 8;
export const MAX_OUTPUT_BYTES = 1_048_576;
export const MAX_ID_LENGTH = 128;
export const MAX_LABEL_LENGTH = 64;

export type ObservationRequest = (
  | { command: "history"; runId?: string }
  | { command: "inspect"; runId: string; stepId?: string }
  | { command: "compare"; runIdA: string; runIdB: string }
  | { command: "receipts"; runId: string }
) & { baseDir?: string; limit?: number };

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "observation"; request: ObservationRequest; json: boolean };

export class CliError extends Error {
  constructor(readonly code: "usage" | "observation" | "output") {
    super(code === "usage" ? "invalid arguments" : code === "output" ? "output limit exceeded" : "observation unavailable");
    this.name = "CliError";
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  omitted: number;
}

export interface ObservationContract {
  observation: "recorded-only";
  storage: "core-best-effort; missing, unreadable, corrupt or invalid records may be omitted";
  independent_verification: "not-performed";
  authorization: "none";
  version_compatibility: "not-assessed";
}

export interface EventView {
  run_id: string;
  step_id: string;
  ts: number;
  component: string;
  action: string;
  result: string;
  reason_code?: string;
  source_sha?: string;
  vista_version?: string;
}

export interface ReadCounts {
  core_returned_events: number;
  projected_events: number;
  identity_withheld_events: number;
}

export interface CountEntry {
  label: string | null;
  count: number;
}

export const COUNT_FIELDS = ["component", "result", "reason_code", "source_sha"] as const;
export type CountField = typeof COUNT_FIELDS[number];
export type RecordedCounts = Record<CountField, Page<CountEntry>>;

export interface CheckpointView {
  run_id: string;
  step_id: string;
  ts: number;
  source_sha: string;
  env_fingerprint: string;
  policy_version: string;
  completed_steps: Page<string>;
  pending_steps: Page<string>;
  check_fn_ids: Page<string>;
  resume_requires: Page<string>;
  owner_claimed_resumable: boolean;
}

export interface StatView {
  label: string;
  value: number | string;
}

export interface ReceiptObservation {
  event: EventView;
  owner_claimed_verified: boolean | null;
  owner_claimed_stats: Page<StatView>;
  withheld_stats: number;
}

export interface ReceiptView {
  type: string;
  ref: string;
  sha?: string;
  occurrences: number;
  observations: Page<ReceiptObservation>;
}

export interface Difference {
  label: string | null;
  a: number;
  b: number;
  delta_b_minus_a: number;
}

export type ObservationView = ObservationContract & (
  | { command: "history"; mode: "inventory"; runs: Page<string>; withheld_run_ids: number }
  | { command: "history"; mode: "timeline"; run_id: string; reads: ReadCounts; events: Page<EventView> }
  | { command: "inspect"; run_id: string; step_id?: string; reads: ReadCounts; recorded_counts: RecordedCounts; events: Page<EventView>; checkpoints: Page<CheckpointView>; withheld_checkpoint_ids: number }
  | { command: "compare"; run_id_a: string; run_id_b: string; reads_a: ReadCounts; reads_b: ReadCounts; differences: Record<CountField, Page<Difference>> }
  | { command: "receipts"; run_id: string; reads: ReadCounts; metadata: "owner-claimed; not independently verified; not authorization"; withheld_refs: number; receipts: Page<ReceiptView> }
);

export function page<T>(items: readonly T[], limit: number): Page<T> {
  return { items: items.slice(0, limit), total: items.length, omitted: Math.max(0, items.length - limit) };
}

/** Code-unit ordering is independent of host locale and stable for ties. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
