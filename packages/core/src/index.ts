export type { VistaCheckpoint, VistaEvent, VistaComponent, VistaResult } from "@pi-vista/protocol";
export { VISTA_PROTOCOL_VERSION } from "@pi-vista/protocol";

export { hasKnownCredential } from "./credential.js";

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
  assertSafeSegment,
  isSafeSegment,
} from "./run-id.js";
export { VistaProtocolError, isVistaComponent, isVistaEvent, isVistaResult, isVistaCheckpoint } from "./validation.js";
export {
  CheckpointStore,
  EventStore,
  defaultBaseDir,
  type StoreOptions,
} from "./store.js";
