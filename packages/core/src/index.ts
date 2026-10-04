export type { VistaCheckpoint, VistaEvent, VistaComponent, VistaResult } from "@pi-vista/protocol";
export { VISTA_PROTOCOL_VERSION } from "@pi-vista/protocol";

export {
  createEmitter,
  emitVistaEvent,
  type EmitOptions,
  type VistaEmitter,
  type VistaEventInput,
} from "./emit.js";
export {
  isRedacted,
  redactAll,
  redactCommand,
  redactCredential,
  redactPath,
  RedactionError,
  REDACTION_MARKERS,
} from "./redact.js";
export {
  currentRunId,
  generateRunId,
  generateStepId,
  getOrCreateRunId,
} from "./run-id.js";
export {
  CheckpointStore,
  EventStore,
  defaultBaseDir,
  type StoreOptions,
} from "./store.js";
