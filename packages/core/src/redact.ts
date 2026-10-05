const REDACTED_MARKER = "[REDACTED]";
const REDACTED_PATH_MARKER = "[REDACTED_PATH]";
const REDACTED_CREDENTIAL_MARKER = "[REDACTED_CREDENTIAL]";
const REDACTED_COMMAND_MARKER = "[REDACTED_COMMAND]";

const URL_USERINFO_PATTERN = /([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu;
const URL_QUERY_PARAMETER_PATTERN = /([?&#])([a-z][a-z0-9_.-]*)=([^&#\s]*)/giu;
const URL_FRAGMENT_PATTERN = /#[^\s<>'"`]+/gu;
const ASSIGNMENT_SECRET_PATTERN = /\b([a-z][a-z0-9_-]*)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const BEARER_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/giu;
const PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu;
const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const WINDOWS_PATH_PATTERN = /(?:\b[A-Za-z]:[\\/]+|\\\\[A-Za-z0-9._-]+[\\/]+)[^\s"'`<>|;&]+/g;
const POSIX_PATH_PATTERN = /(?<![\w:/])(?:\/[A-Za-z0-9._~@%+\-]+)+/g;
const ROOT_PATH_PATTERN = /(?<![\w:/])\/(?=$|[\s"'`<>|;&])/g;
const HOME_PATH_PATTERN = /~[\\/][^\s"'`<>|;&]+/g;
const FILE_URL_PATTERN = /\bfile:\/\/[^\s"'`<>|;&]+/giu;
const COMMAND_WORDS = "bash|cat|cd|chmod|chown|command|cp|curl|docker|echo|env|export|false|find|git|grep|kill|kubectl|ls|make|mkdir|mv|node|npm|npx|openssl|perl|pip|pnpm|printf|pwd|pytest|python(?:3)?|read|rm|scp|sed|set|sh|sleep|source|ssh|tar|test|touch|true|tsc|uname|unset|wait|wget|which|whoami|xargs|yarn|zip|zsh";
const COMMAND_PATTERN = new RegExp(`(?:^|\\b)(?:sudo\\s+)?(?:${COMMAND_WORDS})\\s+[^\\n]*`, "iu");
const SHELL_SYNTAX_PATTERN = /(?:&&|\|\||\||[;`]|\$\(|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\r?\n|(?:^|\s)[<>](?:\s|\S))/u;

/** Long unknown strings are treated as potentially sensitive model or tool data. */
const UNKNOWN_TEXT_MAX_LENGTH = 64;

/** Error raised when a value cannot be safely represented after redaction. */
export class RedactionError extends Error {
  constructor(message = "value cannot be safely redacted") {
    super(message);
    this.name = "RedactionError";
  }
}

function requireString(value: string, kind: string): string {
  if (typeof value !== "string") {
    throw new RedactionError(`${kind} must be a string`);
  }
  return value;
}

function redactPathFragments(value: string): string {
  // Do not protect URLs before path handling: query and fragment values can
  // contain absolute paths (for example ?file=/Users/alice/secret.txt).
  return value
    .replace(FILE_URL_PATTERN, REDACTED_PATH_MARKER)
    .replace(WINDOWS_PATH_PATTERN, REDACTED_PATH_MARKER)
    .replace(POSIX_PATH_PATTERN, REDACTED_PATH_MARKER)
    .replace(ROOT_PATH_PATTERN, REDACTED_PATH_MARKER)
    .replace(HOME_PATH_PATTERN, REDACTED_PATH_MARKER);
}

function redactCredentialFragments(value: string): string {
  return value
    .replace(PEM_PATTERN, REDACTED_CREDENTIAL_MARKER)
    .replace(URL_USERINFO_PATTERN, `$1${REDACTED_CREDENTIAL_MARKER}@`)
    .replace(URL_QUERY_PARAMETER_PATTERN, (match: string, prefix: string, key: string, parameterValue: string) =>
      isCredentialKey(key) ? `${prefix}${key}=${REDACTED_CREDENTIAL_MARKER}` : `${prefix}${key}=${parameterValue}`,
    )
    // Fragments are opaque to pi-vista and can carry tokens or paths. Keep a
    // path marker when one is present; otherwise replace the whole fragment.
    .replace(URL_FRAGMENT_PATTERN, (fragment: string) => {
      const pathRedacted = redactPathFragments(fragment);
      return pathRedacted === fragment ? `#${REDACTED_CREDENTIAL_MARKER}` : pathRedacted;
    })
    .replace(BEARER_PATTERN, REDACTED_CREDENTIAL_MARKER)
    .replace(ASSIGNMENT_SECRET_PATTERN, (match: string, key: string, separator: string) =>
      isCredentialKey(key) ? `${key}${separator}${REDACTED_CREDENTIAL_MARKER}` : match,
    )
    .replace(TOKEN_PATTERN, REDACTED_CREDENTIAL_MARKER);
}

function normalizedKey(key: string | undefined): string {
  return (key ?? "").replace(/[_.-]/gu, "").toLowerCase();
}

function isCommandKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  if (normalized.length === 0) {
    return false;
  }
  const commandTokens = ["arg", "args", "argv", "command", "cmd", "script", "shell", "stdin", "commandline", "shellcommand"];
  return commandTokens.some((token) =>
    normalized === token || normalized.startsWith(token) || normalized.endsWith(token),
  );
}

function isPathKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized.length > 0 && /(?:absolutepath|path|file|filename|directory|dir|cwd|root|worktree|location)/u.test(normalized);
}

function isCredentialKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized.length > 0 && /(?:accesstoken|apikey|authorization|cookie|credential|password|passwd|privatekey|refreshtoken|secret|token)/u.test(normalized);
}

function isModelDataKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized.length > 0 && /(?:prompttext|prompt|modelprompt|modelinput|modeloutput|completion|output|input|request|response|taskgoal|currentstate|stderr|stdout|content|body|message)/u.test(normalized);
}

function isIdentityKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized.length > 0 && /(?:email|home|login|user|userid|username)/u.test(normalized);
}

function isSafeTextKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return /^(?:runid|stepid|sessionid|traceid|component|repo|sourcesha|worktreeid|branch|targetclass|policyversion|layer|envfingerprint|modelid|vistaversion|result|url|uri|href)$/u.test(normalized);
}

function isUnknownLongText(value: string, key: string | undefined): boolean {
  return value.length > UNKNOWN_TEXT_MAX_LENGTH && !isSafeTextKey(key);
}

function looksLikeCommand(value: string, key: string | undefined): boolean {
  if (isCommandKey(key)) {
    return true;
  }
  if (normalizedKey(key) === "action" && /\s/u.test(value)) {
    return true;
  }
  return COMMAND_PATTERN.test(value) || SHELL_SYNTAX_PATTERN.test(value);
}

function sanitizeString(value: string, key: string | undefined): string {
  if (isCommandKey(key)) {
    return REDACTED_COMMAND_MARKER;
  }
  if (isPathKey(key)) {
    return REDACTED_PATH_MARKER;
  }
  if (isCredentialKey(key)) {
    return REDACTED_CREDENTIAL_MARKER;
  }
  if (isModelDataKey(key) || isIdentityKey(key) || isUnknownLongText(value, key)) {
    return REDACTED_MARKER;
  }

  let result = redactCredentialFragments(value);
  result = redactPathFragments(result);
  if (looksLikeCommand(result, key)) {
    return REDACTED_COMMAND_MARKER;
  }
  return result;
}

/** Redact a filesystem path. The original path is never retained. */
export function redactPath(value: string): string {
  requireString(value, "path");
  return REDACTED_PATH_MARKER;
}

/** Redact a credential, token, or other authentication value. */
export function redactCredential(value: string): string {
  requireString(value, "credential");
  return REDACTED_CREDENTIAL_MARKER;
}

/** Redact a complete shell command rather than attempting to parse its arguments. */
export function redactCommand(value: string): string {
  requireString(value, "command");
  return REDACTED_COMMAND_MARKER;
}

function cloneAndRedact(value: unknown, seen: WeakSet<object>, key?: string): unknown {
  if (isCommandKey(key)) {
    return REDACTED_COMMAND_MARKER;
  }
  if (isPathKey(key)) {
    return REDACTED_PATH_MARKER;
  }
  if (isCredentialKey(key)) {
    return REDACTED_CREDENTIAL_MARKER;
  }
  if (isModelDataKey(key) || isIdentityKey(key)) {
    return REDACTED_MARKER;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return typeof value === "string" ? sanitizeString(value, key) : value;
  }

  if (typeof value !== "object") {
    throw new RedactionError("unsupported value type");
  }
  if (seen.has(value)) {
    throw new RedactionError("circular value cannot be safely redacted");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => cloneAndRedact(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [property, propertyValue] of Object.entries(value)) {
    result[property] = cloneAndRedact(propertyValue, seen, property);
  }
  seen.delete(value);
  return result;
}

/**
 * Recursively redact an event/checkpoint-like value.
 *
 * Known model, command, path, identity, and credential fields are replaced
 * regardless of their spelling/casing. Unknown long strings are also replaced
 * so a newly added object field cannot silently become a raw prompt or tool
 * payload. Unsupported or circular values throw RedactionError so callers can
 * fail open without accidentally persisting an unsafe object.
 */
export function redactAll<T>(value: T): T {
  return cloneAndRedact(value, new WeakSet<object>()) as T;
}

/** Return whether a value contains one of pi-vista's explicit redaction markers. */
export function isRedacted(value: unknown): boolean {
  if (typeof value === "string") {
    return /\[REDACTED(?:_[A-Z]+)?\]/u.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => isRedacted(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => isRedacted(item));
  }
  return false;
}

/** @internal Markers are exported for consumers that need stable display labels. */
export const REDACTION_MARKERS = {
  all: REDACTED_MARKER,
  path: REDACTED_PATH_MARKER,
  credential: REDACTED_CREDENTIAL_MARKER,
  command: REDACTED_COMMAND_MARKER,
} as const;
