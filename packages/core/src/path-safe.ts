/**
 * The identifier grammar shared by generated IDs and on-disk store paths.
 * Keeping this check in one place prevents an ID producer from creating a
 * value that the store cannot safely use as a path segment.
 */
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

export function isSafeSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    SAFE_SEGMENT_PATTERN.test(value)
  );
}

export function assertSafeSegment(value: unknown, label: string): string {
  if (!isSafeSegment(value)) {
    throw new TypeError(`${label} must be a path-safe identifier`);
  }
  return value;
}
