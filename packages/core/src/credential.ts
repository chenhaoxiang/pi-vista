// No word boundaries: known signatures can be embedded in an otherwise legal
// metadata namespace or ID. No global/sticky flag: repeated calls are stateless.
const KNOWN_CREDENTIAL_PATTERN = /(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/iu;

/**
 * Detect known embedded GitHub, SK, Slack and three-part JWT signatures.
 * Accepts only primitive strings; never coerces or inspects objects. This is
 * not a general secret/encoding detector or an authorization decision.
 */
export function hasKnownCredential(value: unknown): boolean {
  return typeof value === "string" && KNOWN_CREDENTIAL_PATTERN.test(value);
}
