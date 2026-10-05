/**
 * Shared runtime grammars for protocol fields that retain text after redaction.
 * These are deliberately narrower than the protocol's general string fields.
 */

const CUSTOM_COMPONENT_NAME_PATTERN = /^[^\s\p{Cc}\p{Cf}]+$/u;
const CUSTOM_COMPONENT_CREDENTIAL_ASSIGNMENT_PATTERN = /(?:^|[./:_-])(?:[A-Za-z0-9-]*[_-])?(?:secret|token|password|passwd|api(?:[_-]?key)?|access[_-]?key|auth|credential|private[_-]?key|ssh[_-]?key)[A-Za-z0-9_.-]*\s*[:=]/iu;
const CUSTOM_COMPONENT_UNSAFE_PATTERN = /(?:\\|[?&=#%]|^[/\\~]|^[A-Za-z]:[/\\]|:\/|:\/\/|(?:^|\/)\.\.?(?:\/|$)|&&|\|\||[;`$<>])/iu;
const CUSTOM_COMPONENT_TOKEN_PATTERN = /(?:gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/u;
const REDACTION_CUSTOM_COMPONENT_PATTERN = /^custom:\[REDACTED(?:_[A-Z]+)?\]$/u;

const STATS_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u;
const SENSITIVE_STATS_KEY_PATTERN = /(?:accesskey|accesstoken|apikey|auth|cookie|credential|password|passwd|privatekey|refreshtoken|secret|token|sshkey|signingkey|absolutepath|command|cwd|directory|filename|filepath|path|shell|url|uri|href)/u;
const STATS_VALUE_PATTERN = /^[\p{L}\p{M}\p{N}._:@+-]{1,64}$/u;
const REDACTION_MARKER_PATTERN = /^\[REDACTED(?:_[A-Z]+)?\]$/u;

/** Maximum number of stats entries retained from one ArtifactRef. */
export const MAX_STATS_ENTRIES = 32;

/** Maximum length of a retained string stats value. */
export const MAX_STATS_VALUE_LENGTH = 64;

/**
 * The shared custom-component shape used by the runtime validator and the
 * redactor. The protocol type intentionally remains `custom:${string}`;
 * runtime records require a non-empty, non-whitespace, control-free suffix;
 * path-, credential-, URL-, and shell-like payloads are rejected.
 */
export function isSafeCustomComponent(value: unknown): value is `custom:${string}` {
  if (typeof value !== "string" || !value.startsWith("custom:")) {
    return false;
  }
  if (REDACTION_CUSTOM_COMPONENT_PATTERN.test(value)) {
    return true;
  }
  const name = value.slice("custom:".length);
  return (
    CUSTOM_COMPONENT_NAME_PATTERN.test(name) &&
    !CUSTOM_COMPONENT_CREDENTIAL_ASSIGNMENT_PATTERN.test(name) &&
    !CUSTOM_COMPONENT_UNSAFE_PATTERN.test(name) &&
    !CUSTOM_COMPONENT_TOKEN_PATTERN.test(name) &&
    name.split("/").every((segment) => segment !== "." && segment !== "..")
  );
}

/** Return whether a stats key is a short, control-free metadata label. */
export function isSafeStatsKey(value: unknown): value is string {
  return typeof value === "string" && STATS_KEY_PATTERN.test(value);
}

/** Return whether a stats key is safe to retain after redaction. */
export function isRetainedStatsKey(value: unknown): value is string {
  return (
    isSafeStatsKey(value) &&
    !SENSITIVE_STATS_KEY_PATTERN.test(value.replace(/[_.:-]/gu, "").toLowerCase())
  );
}

/** Return whether an incoming stats string is bounded and control-free. */
export function isValidStatsString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_STATS_VALUE_LENGTH && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** Return whether a stats value can be retained as short metadata text. */
export function isSafeStatsValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_STATS_VALUE_LENGTH &&
    (REDACTION_MARKER_PATTERN.test(value) || (
      STATS_VALUE_PATTERN.test(value) &&
      !CUSTOM_COMPONENT_TOKEN_PATTERN.test(value)
    ))
  );
}
