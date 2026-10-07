import { constants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { canonical, hash, invalid } from "../data.js";

const MAX_RECORD_BYTES = 262_144;
function privateFile(stat: Stats): void {
  if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1 || stat.size > MAX_RECORD_BYTES) invalid();
}
function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }
export interface AttemptJournal {
  claim(): Promise<boolean>;
  complete(): Promise<void>;
  existing(): Promise<void>;
  close(): Promise<void>;
}
/** Cooperative local POSIX attempt record, not an NFS lock or malicious-filesystem sandbox. */
export async function attemptJournal(root: string, identity: string, claim: string, check: () => void): Promise<AttemptJournal> {
  check(); let component = "/"; let last: Stats | undefined;
  for (const part of root.slice(1).split("/")) {
    component = path.posix.join(component, part); check(); last = await lstat(component);
    if (!last.isDirectory() || last.isSymbolicLink()) invalid();
  }
  if (!last || last.uid !== process.getuid!() || (last.mode & 0o7777) !== 0o700) invalid();
  const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await directory.stat();
    if (stat.dev !== last.dev || stat.ino !== last.ino || stat.uid !== last.uid || (stat.mode & 0o7777) !== 0o700) invalid();
  } catch (error) { await directory.close(); throw error; }
  const name = hash(identity); const completion = canonical({ schema: 1, claim_digest: hash(claim) });
  async function checkRoot(): Promise<void> {
    check(); const current = await lstat(root); const held = await directory.stat();
    if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== held.ino || current.dev !== held.dev ||
      current.uid !== process.getuid!() || (current.mode & 0o7777) !== 0o700) invalid();
  }
  async function read(suffix: string): Promise<string | null> {
    await checkRoot(); let file: FileHandle;
    try { file = await open(path.posix.join(root, `${name}.${suffix}`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (code(error) === "ENOENT") return null; throw error; }
    try {
      privateFile(await file.stat()); const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1); let size = 0;
      while (size < buffer.length) {
        check(); const result = await file.read(buffer, size, buffer.length - size, null); if (result.bytesRead === 0) break; size += result.bytesRead;
      }
      privateFile(await file.stat()); if (!size || size > MAX_RECORD_BYTES) invalid();
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
    } finally { await file.close(); }
  }
  async function create(suffix: string, bytes: string): Promise<boolean> {
    await checkRoot(); let file: FileHandle;
    try { file = await open(path.posix.join(root, `${name}.${suffix}`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (code(error) === "EEXIST") return false; throw error; }
    try { privateFile(await file.stat()); check(); await file.writeFile(bytes, "utf8"); check(); await file.sync(); privateFile(await file.stat()); }
    finally { await file.close(); }
    check(); await directory.sync(); check(); return true;
  }
  async function checkedCompletion(): Promise<boolean> {
    const value = await read("complete"); if (value !== null && value !== completion) invalid(); return value !== null;
  }
  async function existing(): Promise<void> { if (await read("intent") !== claim) invalid(); await checkedCompletion(); }
  return {
    async claim() {
      const first = await create("intent", claim);
      if (await read("intent") !== claim) invalid();
      const done = await checkedCompletion(); return first && !done;
    },
    existing,
    async complete() {
      await existing();
      if (!await create("complete", completion) && await read("complete") !== completion) invalid();
    },
    close: () => directory.close(),
  };
}
