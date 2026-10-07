import { createPublicKey } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { posix } from "node:path";
import { performance } from "node:perf_hooks";
import { types } from "node:util";
import { evidenceMessage, type EvidenceKind, type EvidenceSource } from "./index.js";
import { EvidenceError, canonical, digest, integer, label, list, own } from "./data.js";

export interface ReceiptFileSource {
  readonly subject: string;
  readonly file_id: string;
  readonly issuer: string;
  readonly kind: EvidenceKind;
  /** Canonical SPKI Ed25519 public PEM, including its terminal LF. */
  readonly public_key: string;
}
export interface ReceiptFileConfig {
  /** Existing canonical absolute private POSIX directory; never discovered or created. */
  readonly root: string;
  readonly sources: readonly ReceiptFileSource[];
  /** Explicit total file-byte bound, 1–1,048,576. */
  readonly max_bytes: number;
  /** Explicit monotonic per-read deadline, 1–10,000 ms. OS waits are not preemptible. */
  readonly timeout_ms: number;
}
interface Mapping { readonly path: string; readonly source: Omit<EvidenceSource, "read">; }
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const identityKeys = ["dev", "ino", "mode", "uid", "gid"] as const;
const metadataKeys = [...identityKeys, "nlink", "size", "mtimeNs", "ctimeNs"] as const;
function refused(): never { throw new EvidenceError("unverified-evidence"); }
function equal(a: BigIntStats, b: BigIntStats, metadata = true): boolean {
  return (metadata ? metadataKeys : identityKeys).every(key => a[key] === b[key]);
}
function privateDirectory(s: BigIntStats, uid: bigint): void {
  if (!s.isDirectory() || s.uid !== uid || (s.mode & 0o7777n) !== 0o700n) refused();
}
function privateFile(s: BigIntStats, uid: bigint, max: number): void {
  if (!s.isFile() || s.uid !== uid || s.nlink !== 1n || (s.mode & 0o7777n) !== 0o600n || s.size < 1n || s.size > BigInt(max)) refused();
}
function freezeTree(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
}
/** Transport syntax only: no signature/digest/binding/freshness/success decision. */
function decode(bytes: Buffer): unknown {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refused();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const envelope: unknown = JSON.parse(body);
  const v = own(envelope, ["payload", "content_digest", "signature"]);
  if (evidenceMessage(v.payload) !== canonical(v.payload) || digest(v.content_digest) !== v.content_digest ||
    typeof v.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/u.test(v.signature)) refused();
  const signature = Buffer.from(v.signature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== v.signature || canonical(envelope) !== body) refused();
  freezeTree(envelope); return envelope;
}

async function read(root: string, file: string, uid: bigint, max: number, timeout: number, signal: AbortSignal): Promise<unknown> {
  // Use the native brand/getter, not caller properties or coercion hooks.
  try {
    if (types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype) throw new Error();
    aborted.call(signal);
  } catch { throw new EvidenceError("invalid-input"); }
  const deadline = performance.now() + timeout;
  const active = (): void => {
    if (aborted.call(signal)) refused();
    if (performance.now() >= deadline) throw new EvidenceError("evidence-timeout");
  };
  const owned: FileHandle[] = [];
  // No abandoned open promise: retain its descriptor BEFORE checking elapsed time.
  const open = async (path: string, directory: boolean): Promise<FileHandle> => {
    active();
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0));
    owned.push(handle); active(); return handle;
  };
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    active(); const result = await operation(); active(); return result;
  };
  const components = ["/"];
  for (const part of root.slice(1).split("/")) components.push(posix.join(components[components.length - 1]!, part));
  const sampleRoot = async (): Promise<BigIntStats[]> => {
    const stats: BigIntStats[] = [];
    for (const path of components) {
      const stat = await wait(() => fs.lstat(path, { bigint: true }));
      if (!stat.isDirectory() || stat.isSymbolicLink()) refused();
      stats.push(stat);
    }
    privateDirectory(stats[stats.length - 1]!, uid);
    return stats;
  };
  try {
    const before = await sampleRoot(); active();
    const directory = await open(root, true);
    const rootStat = await wait(() => directory.stat({ bigint: true }));
    privateDirectory(rootStat, uid);
    if (!equal(rootStat, before[before.length - 1]!)) refused();
    const pathStat = await wait(() => fs.lstat(file, { bigint: true }));
    privateFile(pathStat, uid, max);
    const handle = await open(file, false);
    const fileStat = await wait(() => handle.stat({ bigint: true }));
    privateFile(fileStat, uid, max);
    if (!equal(pathStat, fileStat)) refused();
    // Read the observed size plus one byte: partial reads are allowed, truncation/growth is not.
    const bytes = Buffer.alloc(Number(fileStat.size) + 1); let offset = 0;
    while (offset < bytes.length) {
      const result = await wait(() => handle.read(bytes, offset, bytes.length - offset, offset));
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (BigInt(offset) !== fileStat.size) refused();
    const finalFile = await wait(() => handle.stat({ bigint: true }));
    const finalPath = await wait(() => fs.lstat(file, { bigint: true }));
    privateFile(finalFile, uid, max); privateFile(finalPath, uid, max);
    if (!equal(fileStat, finalFile) || !equal(fileStat, finalPath)) refused();
    const finalRoot = await wait(() => directory.stat({ bigint: true }));
    const after = await sampleRoot(); active();
    if (!equal(rootStat, finalRoot) || !before.every((stat, i) => equal(stat, after[i]!, i === before.length - 1))) refused();
    const envelope = decode(bytes.subarray(0, offset)); active(); return envelope;
  } catch (error) {
    active();
    if (error instanceof EvidenceError && error.code === "evidence-timeout") throw new EvidenceError("evidence-timeout");
    throw new EvidenceError("unverified-evidence");
  } finally {
    // Cancellation never skips owned descriptor closure; OS close waits are not preemptible.
    let failed = false;
    for (const handle of owned.reverse()) { try { await handle.close(); } catch { failed = true; } }
    if (failed) throw new EvidenceError("unverified-evidence");
    active();
  }
}

/** Explicit trusted-host file transport; importing/constructing performs no filesystem I/O. */
export function createReceiptFileSources(config: ReceiptFileConfig): readonly EvidenceSource[] {
  let root: string, uid: bigint, max: number, timeout: number, mappings: Mapping[];
  try {
    const c = own(config, ["root", "sources", "max_bytes", "timeout_ms"]);
    if (process.platform === "win32" || typeof process.getuid !== "function" ||
      !Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK) || !Number.isInteger(constants.O_DIRECTORY) ||
      typeof c.root !== "string" || c.root.length > 4096 || c.root === "/" || !c.root.startsWith("/") ||
      /[\\\x00-\x1f\x7f]/u.test(c.root) || posix.normalize(c.root) !== c.root || c.root.endsWith("/") || c.root.split("/").length > 128) throw new Error();
    root = c.root; uid = BigInt(process.getuid());
    max = integer(c.max_bytes, 1_048_576, 1); timeout = integer(c.timeout_ms, 10_000, 1);
    const subjects = new Set<string>(), files = new Set<string>();
    mappings = list(c.sources, 64).map(input => {
      const s = own(input, ["subject", "file_id", "issuer", "kind", "public_key"]);
      const subject = label(s.subject), fileId = label(s.file_id), issuer = label(s.issuer);
      if (subjects.has(subject) || files.has(fileId.toLowerCase()) || !["gate", "test", "guard"].includes(s.kind as string) ||
        typeof s.public_key !== "string" || s.public_key.length > 4096 ||
        !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n$/u.test(s.public_key)) throw new Error();
      const key = createPublicKey(s.public_key);
      if (key.type !== "public" || key.asymmetricKeyType !== "ed25519" || key.export({ type: "spki", format: "pem" }).toString() !== s.public_key) throw new Error();
      subjects.add(subject); files.add(fileId.toLowerCase());
      return { path: posix.join(root, `${fileId}.receipt.json`), source: Object.freeze({ subject, issuer, kind: s.kind as EvidenceKind, public_key: s.public_key }) };
    });
  } catch { throw new EvidenceError("invalid-config"); }
  return Object.freeze(mappings.map(mapping => Object.freeze({ ...mapping.source,
    read: async (signal: AbortSignal): Promise<unknown> => read(root, mapping.path, uid, max, timeout, signal),
  })));
}
