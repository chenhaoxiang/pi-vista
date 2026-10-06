import type { CheckFunctionType, VistaCheckFunction } from "@pi-vista/protocol";

export const MAX_CHECKS = 64;
export const MAX_HANDLERS = 64;
export const MAX_PARAMS = 16;
export const MAX_LABEL_LENGTH = 128;
export const MAX_PARAM_KEY_LENGTH = 32;
export const MAX_DESCRIPTION_LENGTH = 256;
export const DEFAULT_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 10_000;

/** Opaque host labels only, never filesystem paths or collected environment data. */
export interface CheckContext {
  readonly repo?: string;
  readonly task?: string;
  readonly branch?: string;
  readonly sha?: string;
}

export interface CheckRunOptions {
  readonly timeoutMs?: number;
}

export type CheckDefinition = Readonly<Omit<VistaCheckFunction, "params" | "on_fail"> & {
  readonly params: Readonly<Record<string, string>>;
  readonly on_fail: "STOP" | "WARN";
}>;

export interface CheckInvocation {
  readonly definition: CheckDefinition;
  readonly context: Readonly<CheckContext>;
  readonly signal: AbortSignal;
}

/** Trusted in-process host code. Serialized behavior and thenables are not handlers. */
export type CheckHandler = (invocation: CheckInvocation) => boolean | Promise<boolean>;

export type CheckReason =
  | "predicate-true"
  | "predicate-false"
  | "missing-handler"
  | "handler-threw"
  | "invalid-verdict"
  | "timeout"
  | "stopped"
  | "preflight-rejected";

export interface CheckResult {
  readonly check_id: string;
  readonly type: CheckFunctionType;
  readonly status: "passed" | "failed" | "warning" | "skipped";
  readonly reason: CheckReason;
}

export interface CheckReport {
  readonly verification: "predicate-only";
  readonly authorization: "none";
  readonly satisfied: boolean;
  readonly results: readonly CheckResult[];
}

export type CheckErrorCode =
  | "invalid-input"
  | "unsupported-repair"
  | "invalid-registration"
  | "duplicate-registration"
  | "registry-busy";

const ERROR_MESSAGES: Record<CheckErrorCode, string> = {
  "invalid-input": "invalid check input",
  "unsupported-repair": "repair is unsupported",
  "invalid-registration": "invalid check registration",
  "duplicate-registration": "check handler already registered",
  "registry-busy": "check registry is running",
};

export class CheckError extends Error {
  constructor(readonly code: CheckErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CheckError";
    // Public failures must not expose input, handler errors, or machine paths.
    this.stack = `${this.name}: ${this.message}`;
  }
}
