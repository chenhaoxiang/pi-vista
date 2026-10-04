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

  /** Summary stats (e.g. { passed: 19, total: 19 }) */
  stats?: Record<string, number | string> | undefined;
}
