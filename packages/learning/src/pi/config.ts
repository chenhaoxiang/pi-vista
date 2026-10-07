import { types } from "node:util";
import { hasKnownCredential, isSafeSegment } from "@pi-vista/core";
import { isEvidenceVerifier, type EvidenceSubjects, type EvidenceVerifier } from "@pi-vista/evidence";
import { frozen, integer, invalid, label, list, metadata, own, retrievalBinding } from "../data.js";
import type { PortableRecallConfig } from "../portable-contract.js";
import { PiObservationError, type PiObservationConfig, type PiTask } from "./contract.js";

export function callback<T>(input: unknown): T {
  if (typeof input !== "function" || types.isProxy(input)) invalid(); return input as T;
}
export function task(input: unknown): PiTask {
  const v = own(input, ["repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "task_goal", "bank", "session_alias"],
    ["repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "task_goal", "bank"]);
  return frozen({ ...retrievalBinding(v), task_type: label(v.task_type), task_goal: metadata(v.task_goal), bank: label(v.bank),
    ...(v.session_alias === undefined ? {} : { session_alias: label(v.session_alias) }) });
}
function history(input: unknown): PortableRecallConfig {
  const v = own(input, ["origins", "now", "max_age_ms", "port", "lifecycle", "max_lifecycle_age_ms", "timeout_ms"], ["origins", "now", "max_age_ms"]);
  const origins = frozen(list(v.origins, 64, 1).map(pin => frozen(own(pin,
    ["role", "issuer", "key_id", "repo", "bank", "public_key", "not_before", "not_after", "trust"]))));
  let port: PortableRecallConfig["port"];
  if (v.port !== undefined) {
    const p = own(v.port, ["query", "read"]);
    port = frozen({ query: callback<NonNullable<typeof port>["query"]>(p.query), read: callback<NonNullable<typeof port>["read"]>(p.read) });
  }
  return frozen({ ...v, origins, now: callback<() => number>(v.now),
    ...(port === undefined ? {} : { port }),
    ...(v.lifecycle === undefined ? {} : { lifecycle: callback<NonNullable<PortableRecallConfig["lifecycle"]>>(v.lifecycle) }) }) as unknown as PortableRecallConfig;
}
export interface Config {
  readonly resolveTask: PiObservationConfig["resolve_task"]; readonly now: () => number;
  readonly tools: ReadonlyMap<string, string>; readonly events: PiObservationConfig["events"]; readonly checkpoints: PiObservationConfig["checkpoints"];
  readonly history: PortableRecallConfig | undefined; readonly verifier: EvidenceVerifier | undefined; readonly subjects: EvidenceSubjects | undefined;
  readonly previewOnStart: boolean; readonly timeout: number; readonly maxWork: number; readonly maxCorrelations: number;
  readonly maxItems: number; readonly maxCharacters: number;
}
export function configuration(input: PiObservationConfig): Config {
  try {
    const v = own(input, ["resolve_task", "now", "tools", "events", "checkpoints", "history", "preview_on_start", "verifier", "subjects", "timeout_ms", "max_pending_work", "max_correlations", "max_items", "max_characters"],
      ["resolve_task", "now", "tools"]);
    const resolveTask = callback<Config["resolveTask"]>(v.resolve_task); const now = callback<() => number>(v.now);
    const tools = new Map<string, string>();
    for (const input of list(v.tools, 64)) {
      const t = own(input, ["native_name", "classification"]); const name = t.native_name;
      // Native tool names are lookup-only (read/bash are valid host names), never protocol metadata.
      if (typeof name !== "string" || name.length > 128 || !isSafeSegment(name) || hasKnownCredential(name) || /(?:AKIA|ASIA)[A-Z0-9]{16}/u.test(name) || tools.has(name)) invalid();
      tools.set(name, label(t.classification));
    }
    let events: Config["events"]; let checkpoints: Config["checkpoints"]; let verifier: Config["verifier"]; let subjects: Config["subjects"];
    if (v.events !== undefined) events = frozen({ append: callback<NonNullable<Config["events"]>["append"]>(own(v.events, ["append"]).append) });
    if (v.checkpoints !== undefined) checkpoints = frozen({ save: callback<NonNullable<Config["checkpoints"]>["save"]>(own(v.checkpoints, ["save"]).save) });
    if (v.verifier !== undefined) { if (!isEvidenceVerifier(v.verifier)) invalid(); verifier = v.verifier; }
    if (v.subjects !== undefined) { const s = own(v.subjects, ["gate", "test", "guard"]); subjects = frozen({ gate: label(s.gate), test: label(s.test), guard: label(s.guard) }); }
    if ((verifier === undefined) !== (subjects === undefined)) invalid();
    if (v.preview_on_start !== undefined && typeof v.preview_on_start !== "boolean") invalid();
    return { resolveTask, now, tools, events, checkpoints, verifier, subjects, history: v.history === undefined ? undefined : history(v.history),
      previewOnStart: v.preview_on_start === true, timeout: integer(v.timeout_ms ?? 250, 10_000, 1),
      maxWork: integer(v.max_pending_work ?? 16, 64, 1), maxCorrelations: integer(v.max_correlations ?? 256, 1024, 1),
      maxItems: integer(v.max_items ?? 8, 16, 1), maxCharacters: integer(v.max_characters ?? 8192, 16384, 128) };
  } catch { throw new PiObservationError("invalid-config"); }
}
/** Inspect only needed own event descriptors, never enumerate/traverse the raw event/body/context. */
export function eventField(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object" || types.isProxy(input)) invalid();
  const d = Object.getOwnPropertyDescriptor(input, key);
  if (!d || !Object.hasOwn(d, "value")) invalid(); return d.value;
}
export function callId(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 256) invalid(); return input;
}
