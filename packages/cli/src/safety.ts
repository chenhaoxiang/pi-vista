import { isSafeSegment, isVistaEvent, redactAll } from "@pi-vista/core";
import { MAX_ID_LENGTH, MAX_LABEL_LENGTH } from "./contract.js";

export const WITHHELD = "[REDACTED]";

// No word boundaries: a token wrapped inside another otherwise legal label is
// still sensitive. These checks supplement, never replace, public core redaction.
const KNOWN_CREDENTIAL = /(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN[^\r\n]*PRIVATE KEY|(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+|(?:secret|token|password|passwd|api[_-]?key|access[_-]?key|authorization|credential)\s*[:=])/iu;
const LABEL = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._:@+/-]*$/u;
const DANGEROUS_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export function containsKnownCredential(value: string): boolean {
  return KNOWN_CREDENTIAL.test(value);
}

export function isCliIdentifier(value: unknown): value is string {
  if (!isSafeSegment(value) || value.startsWith("-") || value.length > MAX_ID_LENGTH || containsKnownCredential(value)) {
    return false;
  }
  try {
    return redactAll({ run_id: value }).run_id === value;
  } catch {
    return false;
  }
}

/** Use the public event validator for core run/step binding, not a private helper. */
export function isBoundStep(runId: unknown, stepId: unknown): stepId is string {
  return isCliIdentifier(runId) && isCliIdentifier(stepId) && isVistaEvent({
    run_id: runId, step_id: stepId, ts: 0, component: "pi", action: "cli:binding", result: "unknown",
  });
}

/** Retain only short structured labels unchanged by core; never clip sensitive text. */
export function displayLabel(value: unknown, key: string): string {
  if (
    typeof value !== "string" || value.length > MAX_LABEL_LENGTH ||
    !LABEL.test(value) || containsKnownCredential(value)
  ) {
    return WITHHELD;
  }
  try {
    const redacted = redactAll({ [key]: value }) as Record<string, unknown>;
    return redacted[key] === value ? value : WITHHELD;
  } catch {
    return WITHHELD;
  }
}

export function displayIdentifier(value: unknown): string {
  return isCliIdentifier(value) ? value : WITHHELD;
}

/** URLs, paths, and redaction markers are not usable opaque CLI references. */
export function displayRef(value: unknown): string | undefined {
  if (typeof value !== "string" || !isCliIdentifier(value)) {
    return undefined;
  }
  try {
    const projected = redactAll({ artifact_refs: [{ type: "opaque", ref: value }] });
    return projected.artifact_refs[0]?.ref === value ? value : undefined;
  } catch {
    return undefined;
  }
}

export function safeStatKey(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u.test(value) &&
    !DANGEROUS_PROPERTY_NAMES.has(value) && !containsKnownCredential(value) &&
    !/(?:auth|cookie|credential|password|passwd|secret|token|key|path|shell|command|url|uri|href)/iu.test(value.replace(/[_.:-]/gu, ""));
}
