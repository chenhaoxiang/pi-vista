/**
 * ArtifactRef — a pointer to an external artifact.
 * pi-vista stores references, never content.
 * Content stays in gate / CI / artifact stores at its original location.
 */
export interface ArtifactRef {
  /** Artifact type */
  type:
    | "gate_receipt"
    | "test_result"
    | "ci_log"
    | "diff"
    | "review_evidence"
    | "wheelhouse_manifest"
    | "coverage_report"
    | "deploy_receipt"
    | string;

  /** Opaque reference understood by the owning system (path, URL, ID) */
  ref: string;

  /** Source SHA this artifact was produced from */
  sha?: string | undefined;

  /** Whether the owning system verified this artifact */
  verified?: boolean | undefined;

  /**
   * Short summary metadata (for example `{ passed: 19, total: 19 }`).
   * Numbers must be finite. String labels/values are bounded and are retained
   * only when the core redactor's credential/path/shell-safe policy permits;
   * callers must never use stats for artifact content or secrets.
   */
  stats?: Record<string, number | string> | undefined;
}
