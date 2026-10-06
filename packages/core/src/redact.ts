import { isSafeSegment } from "./path-safe.js";
import {
  isBareCommandWord,
  isBareCustomComponentCommand,
  isCommandInvocation,
  isRetainedStatsKey,
  isSafeCustomComponent,
  isSafeStatsValue,
  isSafeVistaVersion,
  isValidStatsString,
  MAX_STATS_ENTRIES,
} from "./safe-fields.js";

const REDACTED_MARKER = "[REDACTED]";
const REDACTED_PATH_MARKER = "[REDACTED_PATH]";
const REDACTED_CREDENTIAL_MARKER = "[REDACTED_CREDENTIAL]";
const REDACTED_COMMAND_MARKER = "[REDACTED_COMMAND]";

const URL_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s<>'"`]+/giu;
const FULL_URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\/[^\s<>'"`]+$/iu;
const URL_QUERY_PARAMETER_PATTERN = /([?&])([^=?&#\s]+)=([^&#\s]*)/gu;
const ASSIGNMENT_SECRET_PATTERN = /\b([a-z][a-z\d_.-]*)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const BEARER_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/giu;
const PEM_PATTERN = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gu;
const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const WINDOWS_PATH_PATTERN = /(?:\b[A-Za-z]:[\\/]+|\\\\[A-Za-z0-9._-]+[\\/]+)[^\s"'`<>|;&]+/g;
const POSIX_PATH_PATTERN = /(?<![\w:/])(?:\/[A-Za-z0-9._~@%+\-]+)+/g;
const ROOT_PATH_PATTERN = /(?<![\w:/])\/(?=$|[\s"'`<>|;&])/g;
const HOME_PATH_PATTERN = /~[\\/][^\s"'`<>|;&]+/g;
const SHELL_SYNTAX_PATTERN = /(?:&&|\|\||\||[;`]|\$\(|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\r?\n|(?:^|\s)[<>](?:\s|\S))/u;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._:@+\-]+$/u;
const SAFE_SLASH_METADATA_PATTERN = /^[A-Za-z0-9._:@+\-]+(?:\/[A-Za-z0-9._:@+\-]+)*$/u;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;

/** Only protocol-defined metadata/ID fields opt in to retaining text. */
const SAFE_IDENTIFIER_KEYS = new Set([
  "runid", "stepid", "sessionid", "traceid", "checkid", "failureid",
  "experienceid", "hindsightdocid", "supersededby", "sourcesha", "verifiedsha",
  "worktreeid", "envfingerprint", "repairactionid", "sha",
]);
const SAFE_IDENTIFIER_ARRAY_KEYS = new Set([
  "completedsteps", "pendingsteps", "checkfnids", "resumerequires", "dependson",
]);
const SAFE_METADATA_KEYS = new Set([
  "action", "component", "repo", "branch", "targetclass", "policyversion",
  "layer", "reasoncode", "modelid", "vistaversion", "result", "type", "status",
  "stage", "failuretype", "fixoutcome", "tool", "checktype", "onfailure", "onfail",
  "layaresult", "tasktype",
]);
const URL_KEYS = new Set(["url", "uri", "href"]);
/** Known protocol names that may contain redacted narrative values. */
const KNOWN_PROTOCOL_KEYS = new Set(["rootcause"]);

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

function normalizedKey(key: string | undefined): string {
  return (key ?? "").replace(/[_.-]/gu, "").toLowerCase();
}

function isCommandKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  if (normalized.length === 0) {
    return false;
  }
  if (normalized === "repairactionid") {
    return false;
  }
  const commandTokens = [
    "arg", "args", "argv", "command", "cmd", "cmdline", "script", "shell", "stdin", "stdout", "stderr",
    "exec", "executable", "powershell", "bash", "pipe", "redirect", "heredoc",
    "commandline", "shellcommand", "repairaction",
  ];
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
  // Semantic matching covers new credential names as well as common env
  // assignments such as AWS_ACCESS_KEY_ID, PRIVATE_KEY, and CLIENT_SECRET.
  return normalized.length > 0 && /(?:accesskey|accesstoken|apikey|authorization|auth|cookie|credential|password|passwd|privatekey|refreshtoken|secret|token|sshkey|signingkey)/u.test(normalized);
}

function isModelDataKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized !== "modelid" && /(?:model|prompt|completion|output|input|request|response|taskgoal|currentstate|stderr|stdout|content|body|message|payload|raw)/u.test(normalized);
}

function isIdentityKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized.length > 0 && /(?:email|home|login|user|userid|username)/u.test(normalized);
}

const PROPERTY_KEY_SHELL_PATTERN = /[\s!*?\[\]{};&|`$<>()=#%]/u;

/**
 * Property names are metadata too. Unknown names that look like paths,
 * credentials, commands, or shell syntax are dropped rather than copied into
 * the persisted object. Protocol field names and stats are handled by their
 * explicit allowlists before this predicate is consulted.
 */
function isUnsafePropertyKey(key: string): boolean {
  const normalized = normalizedKey(key);
  const isKnownSafeKey =
    SAFE_IDENTIFIER_KEYS.has(normalized) ||
    SAFE_IDENTIFIER_ARRAY_KEYS.has(normalized) ||
    SAFE_METADATA_KEYS.has(normalized) ||
    KNOWN_PROTOCOL_KEYS.has(normalized) ||
    URL_KEYS.has(normalized) ||
    normalized === "artifactrefs" ||
    normalized === "ref" ||
    normalized === "stats";
  if (isKnownSafeKey) {
    return false;
  }
  return (
    CONTROL_CHARACTER_PATTERN.test(key) ||
    /[\\/]/u.test(key) ||
    key.startsWith("~") ||
    isPathKey(key) ||
    isCredentialKey(key) ||
    isCommandKey(key) ||
    isBareCommandWord(key) ||
    PROPERTY_KEY_SHELL_PATTERN.test(key)
  );
}

function redactPathFragments(value: string): string {
  return value
    .replace(WINDOWS_PATH_PATTERN, REDACTED_PATH_MARKER)
    .replace(POSIX_PATH_PATTERN, REDACTED_PATH_MARKER)
    .replace(ROOT_PATH_PATTERN, REDACTED_PATH_MARKER)
    .replace(HOME_PATH_PATTERN, REDACTED_PATH_MARKER);
}

function redactCredentialFragments(value: string): string {
  return value
    .replace(PEM_PATTERN, REDACTED_CREDENTIAL_MARKER)
    .replace(BEARER_PATTERN, REDACTED_CREDENTIAL_MARKER)
    .replace(ASSIGNMENT_SECRET_PATTERN, (match: string, key: string, separator: string) =>
      isCredentialKey(key) ? `${key}${separator}${REDACTED_CREDENTIAL_MARKER}` : match,
    )
    .replace(TOKEN_PATTERN, REDACTED_CREDENTIAL_MARKER);
}

function markerForFragments(value: string): string {
  if (value.includes(REDACTED_COMMAND_MARKER)) {
    return REDACTED_COMMAND_MARKER;
  }
  if (value.includes(REDACTED_CREDENTIAL_MARKER)) {
    return REDACTED_CREDENTIAL_MARKER;
  }
  if (value.includes(REDACTED_PATH_MARKER)) {
    return REDACTED_PATH_MARKER;
  }
  return REDACTED_MARKER;
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, " "));
  } catch {
    return REDACTED_MARKER;
  }
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") {
      return REDACTED_PATH_MARKER;
    }
    // URLSearchParams decodes both keys and values before classification.
    // Even unknown query keys/values are opaque data, not safe metadata.
    const parameters = Array.from(parsed.searchParams, ([key, parameterValue]) => {
      const keyMarker = isCredentialKey(key)
        ? REDACTED_CREDENTIAL_MARKER
        : isPathKey(key) ? REDACTED_PATH_MARKER : REDACTED_MARKER;
      const valueMarker = keyMarker !== REDACTED_MARKER
        ? keyMarker
        : markerForFragments(redactPathFragments(redactCredentialFragments(parameterValue)));
      return `${keyMarker}=${valueMarker}`;
    });
    const query = parameters.length > 0 ? `?${parameters.join("&")}` : "";
    const fragment = parsed.hash.length > 0
      ? `#${markerForFragments(redactPathFragments(redactCredentialFragments(decodeUrlComponent(parsed.hash.slice(1)))))}`
      : "";
    // host excludes username/password. Pathnames and fragments must never be
    // copied back from the URL; retaining the origin is sufficient for a ref.
    return `${parsed.protocol}//${parsed.host}/${REDACTED_PATH_MARKER}${query}${fragment}`;
  } catch {
    return REDACTED_PATH_MARKER;
  }
}

function redactEncodedFragments(value: string): string {
  if (!/%[0-9a-f]{2}/iu.test(value)) {
    return value;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replace(/\+/gu, " "));
  } catch {
    return REDACTED_MARKER;
  }
  const redacted = redactPathFragments(redactCredentialFragments(decoded));
  if (redacted !== decoded) {
    return markerForFragments(redacted);
  }
  return SHELL_SYNTAX_PATTERN.test(decoded) ? REDACTED_COMMAND_MARKER : value;
}

function sanitizeFragments(value: string, key: string | undefined): string {
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return REDACTED_MARKER;
  }
  let result = value.replace(URL_PATTERN, (url: string) => redactUrl(url));
  result = redactEncodedFragments(result);
  result = result.replace(URL_QUERY_PARAMETER_PATTERN, (match: string, prefix: string, parameterKey: string) =>
    isCredentialKey(decodeUrlComponent(parameterKey))
      ? `${prefix}${REDACTED_CREDENTIAL_MARKER}=${REDACTED_CREDENTIAL_MARKER}`
      : match,
  );
  result = redactPathFragments(redactCredentialFragments(result));
  if (
    ((normalizedKey(key) === "action" || normalizedKey(key) === "vistaversion") && (
      isBareCommandWord(result) ||
      (normalizedKey(key) === "vistaversion" && result.split("/").some((segment) => isBareCommandWord(segment))) ||
      (normalizedKey(key) === "action" && /\s/u.test(result))
    )) ||
    isCommandInvocation(result) || SHELL_SYNTAX_PATTERN.test(result)
  ) {
    return REDACTED_COMMAND_MARKER;
  }
  return result;
}

function sanitizeStatsValue(value: string): string {
  const redacted = sanitizeFragments(value, undefined);
  return isValidStatsString(redacted) && redacted === value && isSafeStatsValue(redacted)
    ? redacted
    : markerForFragments(redacted);
}

function sanitizeString(value: string, key: string | undefined, allowSafeText: boolean): string {
  const normalized = normalizedKey(key);
  if (URL_KEYS.has(normalized)) {
    return FULL_URL_PATTERN.test(value) ? redactUrl(value) : REDACTED_MARKER;
  }
  if (!allowSafeText) {
    return REDACTED_MARKER;
  }
  if (normalized === "ref") {
    // Artifact references retain only a safe opaque ID or a sanitized URL.
    if (FULL_URL_PATTERN.test(value)) {
      return redactUrl(value);
    }
    const redacted = sanitizeFragments(value, key);
    return isSafeSegment(redacted) ? redacted : markerForFragments(redacted);
  }
  if (normalized === "component" && value.startsWith("custom:")) {
    if (isSafeCustomComponent(value)) {
      return value;
    }
    const suffix = value.slice("custom:".length);
    if (isBareCustomComponentCommand(suffix)) {
      return `custom:${REDACTED_COMMAND_MARKER}`;
    }
    const redactedSuffix = sanitizeFragments(suffix, key);
    const redacted = `custom:${redactedSuffix}`;
    return isSafeCustomComponent(redacted)
      ? redacted
      : `custom:${markerForFragments(redactedSuffix)}`;
  }
  if (normalized === "vistaversion") {
    const redacted = sanitizeFragments(value, key);
    return isSafeVistaVersion(redacted) ? redacted : markerForFragments(redacted);
  }
  if (SAFE_IDENTIFIER_KEYS.has(normalized) || SAFE_IDENTIFIER_ARRAY_KEYS.has(normalized)) {
    const redacted = sanitizeFragments(value, key);
    return isSafeSegment(redacted) ? redacted : markerForFragments(redacted);
  }
  if (SAFE_METADATA_KEYS.has(normalized)) {
    const redacted = sanitizeFragments(value, key);
    const pattern = normalized === "branch" || normalized === "modelid"
      ? SAFE_SLASH_METADATA_PATTERN
      : SAFE_METADATA_PATTERN;
    return pattern.test(redacted) ? redacted : markerForFragments(redacted);
  }
  // A short unknown command or model output is just as sensitive as a long
  // one. Newly added fields must opt in to the protocol allowlist above.
  return REDACTED_MARKER;
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

function cloneAndRedact(
  value: unknown,
  seen: WeakSet<object>,
  key?: string,
  allowSafeText = true,
  statsValue = false,
): unknown {
  const normalized = normalizedKey(key);
  const forcedMarker = isCommandKey(key)
    ? REDACTED_COMMAND_MARKER
    : isCredentialKey(key)
      ? REDACTED_CREDENTIAL_MARKER
      : isModelDataKey(key) || isIdentityKey(key)
        ? REDACTED_MARKER
        : isPathKey(key) && !SAFE_IDENTIFIER_KEYS.has(normalized)
          ? REDACTED_PATH_MARKER
          : undefined;

  if (
    value === null || value === undefined ||
    typeof value === "boolean" || typeof value === "number"
  ) {
    if (statsValue && typeof value === "number" && !Number.isFinite(value)) {
      return REDACTED_MARKER;
    }
    return forcedMarker ?? value;
  }
  if (typeof value === "string") {
    return forcedMarker ?? (statsValue ? sanitizeStatsValue(value) : sanitizeString(value, key, allowSafeText));
  }

  if (typeof value !== "object") {
    throw new RedactionError("unsupported value type");
  }
  if (seen.has(value)) {
    throw new RedactionError("circular value cannot be safely redacted");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    // Preserve the owning field for checkpoint IDs. Traverse sensitive
    // values before replacing them so circular/unsupported input still
    // signals a redaction failure instead of being silently accepted.
    const result = value.map((item) => cloneAndRedact(item, seen, key, forcedMarker === undefined && allowSafeText));
    seen.delete(value);
    return forcedMarker ?? result;
  }

  const result: Record<string, unknown> = {};
  const isStatsObject = forcedMarker === undefined && allowSafeText && normalized === "stats";
  // Metadata names inside unknown objects are not an opt-in: only the root
  // protocol object and its artifact refs allow text. Stats are a bounded
  // exception for short labels and values documented by ArtifactRef.
  const allowProperties = forcedMarker === undefined && allowSafeText && (key === undefined || normalized === "artifactrefs");
  let retainedStatsEntries = 0;
  for (const [property, propertyValue] of Object.entries(value)) {
    if (isStatsObject) {
      if (retainedStatsEntries >= MAX_STATS_ENTRIES || !isRetainedStatsKey(property)) {
        // Traverse dropped values so unsupported or circular input still
        // fails closed instead of being silently accepted.
        cloneAndRedact(propertyValue, seen, property, false);
        continue;
      }
      retainedStatsEntries += 1;
      result[property] = cloneAndRedact(propertyValue, seen, property, true, true);
    } else if (isUnsafePropertyKey(property)) {
      // A property name can disclose a path or credential even when its value
      // is redacted. Traverse it for fail-closed handling, but never copy the
      // original name into the persisted object.
      cloneAndRedact(propertyValue, seen, property, false);
    } else {
      result[property] = cloneAndRedact(propertyValue, seen, property, allowProperties);
    }
  }
  seen.delete(value);
  return forcedMarker ?? result;
}

/**
 * Recursively redact an event/checkpoint-like value.
 *
 * Only protocol-defined low-sensitivity metadata and safe IDs retain text.
 * Model/task/payload fields and all unknown text are replaced, regardless of
 * length. Unsupported or circular values throw RedactionError so callers can
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
