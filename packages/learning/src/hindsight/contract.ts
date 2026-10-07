import type { IngestRequest, LearningSink } from "../contract.js";
import type { HindsightRecallPort } from "../portable-contract.js";

/** Private trusted-host configuration; no discovery, activation or service defaults. */
export interface HindsightStoreConfig {
  /** Canonical HTTPS origin only; no userinfo, path prefix, query or fragment. */
  readonly endpoint: string;
  readonly banks: Readonly<Record<string, string>>;
  /** Existing host-owned 0700 POSIX directory; cooperating writers must share it. */
  readonly journal_directory: string;
  readonly bearer_token?: string;
  /** Only literal 127.0.0.1 / [::1] HTTP, explicitly enabled for synthetic fixtures. */
  readonly allow_loopback_http?: boolean;
  readonly timeout_ms?: number;
  readonly max_response_bytes?: number;
}
export interface HindsightReconciliation {
  readonly state: "matched" | "not-confirmed";
  readonly authorization: "none";
  readonly executable: false;
}
export interface HindsightStore {
  readonly sink: LearningSink;
  readonly port: HindsightRecallPort;
  /** Fresh original GET only, with optional local completion; never retain or proof restoration. */
  readonly reconcile: (request: IngestRequest, signal: AbortSignal) => Promise<HindsightReconciliation>;
}
