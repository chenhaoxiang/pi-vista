import type {
  CheckpointStore,
  EmitOptions,
  EventStore,
  VistaCheckpoint,
  VistaEmitter,
  VistaEvent,
  VistaEventInput,
  VistaResult,
} from "@pi-vista/core";

/** A structural ArtifactRef input; content is never accepted by this adapter. */
export type PiArtifactRefInput = NonNullable<VistaEvent["artifact_refs"]>[number];

/**
 * Explicitly supported Pi context construction options. The snake_case aliases
 * mirror protocol fields for extension code that forwards a small config object;
 * they are not an invitation to pass arbitrary Pi API values.
 */
export interface PiRunContextOptions {
  runId?: string | undefined;
  run_id?: string | undefined;
  sessionId?: string | undefined;
  session_id?: string | undefined;
  /**
   * Maximum wait for custom emit, checkpointStore.save, and flush/end (250 ms
   * by default). Observer timeouts are fail-open and do not cancel the work.
   */
  persistTimeoutMs?: number | undefined;
  now?: number | (() => number) | undefined;
  clock?: () => number;
  store?: Pick<EventStore, "append"> | undefined;
  eventStore?: Pick<EventStore, "append"> | undefined;
  checkpointStore?: Pick<CheckpointStore, "save"> | undefined;
  emit?: VistaEmitter | undefined;
}

/**
 * A closed, already-summarized tool-call input. `tool`, `tool_name`, and
 * `name` are aliases for the same short tool label; exactly one may be used.
 * Raw arguments, prompts, output, paths, and model data have no fields here.
 */
export interface PiToolCallInput {
  tool?: string | undefined;
  tool_name?: string | undefined;
  name?: string | undefined;
  action?: string | undefined;
  action_name?: string | undefined;
  targetClass?: string | undefined;
  target_class?: string | undefined;
  reasonCode?: string | undefined;
  reason_code?: string | undefined;
  artifactRefs?: readonly PiArtifactRefInput[] | undefined;
  artifact_refs?: readonly PiArtifactRefInput[] | undefined;
}

/** A tool result must carry an explicit VistaResult; prose is never inferred. */
export interface PiToolResultInput extends PiToolCallInput {
  result: VistaResult;
}

/**
 * A partial checkpoint. Identity and timestamp are filled from this context;
 * the remaining fields are required before CheckpointStore.save is called.
 * Both protocol and camelCase spellings are accepted, with no other fields.
 */
export interface PiCheckpointInput {
  runId?: string | undefined;
  run_id?: string | undefined;
  stepId?: string | undefined;
  step_id?: string | undefined;
  ts?: number | undefined;
  taskGoal?: string | undefined;
  task_goal?: string | undefined;
  completedSteps?: readonly string[] | undefined;
  completed_steps?: readonly string[] | undefined;
  currentState?: string | undefined;
  current_state?: string | undefined;
  pendingSteps?: readonly string[] | undefined;
  pending_steps?: readonly string[] | undefined;
  sourceSha?: string | undefined;
  source_sha?: string | undefined;
  envFingerprint?: string | undefined;
  env_fingerprint?: string | undefined;
  policyVersion?: string | undefined;
  policy_version?: string | undefined;
  checkFnIds?: readonly string[] | undefined;
  check_fn_ids?: readonly string[] | undefined;
  resumable?: boolean | undefined;
  resumeRequires?: readonly string[] | undefined;
  resume_requires?: readonly string[] | undefined;
}

/** A generated step binding returned by the context. */
export interface PiStep {
  readonly runId: string;
  readonly stepId: string;
  readonly seq: number;
}

export interface PiRunContext {
  readonly runId: string;
  readonly sessionId: string | undefined;
  readonly stepId: string | undefined;
  readonly run_id: string;
  readonly session_id: string | undefined;
  readonly step_id: string | undefined;
  getRunId(): string;
  getSessionId(): string | undefined;
  nextStep(): string;
  checkpoint(partial: PiCheckpointInput): Promise<void>;
  emitToolCall(input: PiToolCallInput): Promise<VistaEvent | undefined>;
  emitToolResult(input: PiToolResultInput): Promise<VistaEvent | undefined>;
  withRunContext<T>(callback: (context: PiRunContext) => T | Promise<T>): T | Promise<T>;
  flush(): Promise<void>;
  end(): Promise<void>;
}

export type { EmitOptions, VistaCheckpoint, VistaEmitter, VistaEvent, VistaEventInput, VistaResult };
