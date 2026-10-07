import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import nativeFs from "node:fs/promises";
import syncFs, { constants } from "node:fs";
import { register, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import type { ReceiptFileConfig } from "@pi-vista/evidence/files";

// Controlled fresh child only. All native FS interceptions are restored in finally.
const [role, mode, phaseOrConfig, configFile] = process.argv.slice(2);
const fs = nativeFs as any; const originals: Record<string, any> = {};
let io = 0, writes = 0, opened = 0, closed = 0, afterCancellation = 0, cancelled = false;
const controller = new AbortController(); const record = () => { io++; if (cancelled) afterCancellation++; };
const override = (api: any, name: string, fn: any) => { originals[name] = api[name]; api[name] = fn; };
const writeNames = ["writeFile", "appendFile", "mkdir", "mkdtemp", "chmod", "chown", "unlink", "rm", "rename", "link", "symlink", "truncate", "utimes", "copyFile"];
const writeOriginals = Object.fromEntries(writeNames.map(name => [name, fs[name]]));
const denyWrite = () => { writes++; throw Error("synthetic write refused"); };
let release = () => {}, deregisterLoader = () => {}; let readinessTimer: ReturnType<typeof setTimeout> | undefined;
const syncOriginals: Record<string, any> = {};
try {
  if (role === "isolation") {
    const addon = import.meta.resolve("@pi-vista/evidence/files");
    const loader = `export async function resolve(s, c, next) { const r = await next(s,c); if (r.url === ${JSON.stringify(addon)} && c.parentURL !== ${JSON.stringify(import.meta.url)}) throw Error("synthetic eager addon refused"); return r; }`;
    const hooks = (await import("node:module") as unknown as { registerHooks?: (hooks: { resolve: (s: string, c: any, next: any) => any }) => { deregister: () => void } }).registerHooks;
    if (hooks) {
      const handle = hooks({ resolve: (s, c, next) => {
        const result = next(s, c); if (result.url === addon && c.parentURL !== import.meta.url) throw Error("synthetic eager addon refused"); return result;
      } });
      deregisterLoader = () => handle.deregister();
    } else register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
    const keys = generateKeyPairSync("ed25519");
    for (const name of ["lstat", "stat", "open", "readFile", "readdir", "realpath", ...writeNames]) override(fs, name, () => { io++; throw Error("synthetic I/O refused"); });
    const oldFetch = globalThis.fetch; globalThis.fetch = () => { throw Error("synthetic network refused"); };
    syncBuiltinESMExports();
    try {
      const root = await import("@pi-vista/evidence"); assert.equal("createReceiptFileSources" in root, false);
      const { createReceiptFileSources } = await import("@pi-vista/evidence/files");
      // Prove the real resolver blocker is active, not a source-text/regex assertion.
      await assert.rejects(import("./files.fixtures.js"), /synthetic eager addon refused/u);
      // Loader-owned synchronous module reads are distinct from factory/runtime I/O.
      for (const name of ["openSync", "readFileSync", "lstatSync", "statSync", "readdirSync", "realpathSync", "writeFileSync", "mkdirSync"]) {
        syncOriginals[name] = (syncFs as any)[name]; (syncFs as any)[name] = () => { io++; throw Error("synthetic I/O refused"); };
      }
      syncBuiltinESMExports();
      const sources = createReceiptFileSources({ root: "/explicit-synthetic-nonexistent", max_bytes: 8192, timeout_ms: 1000,
        sources: [{ subject: "gate", issuer: "owner", kind: "gate", file_id: "gate", public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }] });
      assert.equal(sources.length, 1);
      assert.equal(io, 0); console.log(JSON.stringify({ io, writes, root_isolated: true }));
    } finally { globalThis.fetch = oldFetch; }
  } else {
    assert.ok(role === "cancel" || role === "race" || role === "read" || role === "error");
    const { EvidenceError } = await import("@pi-vista/evidence");
    let config = JSON.parse(await fs.readFile(role === "cancel" ? configFile : phaseOrConfig, "utf8")) as ReceiptFileConfig;
    const oldLstat = fs.lstat.bind(fs), oldOpen = fs.open.bind(fs), oldReadFile = fs.readFile.bind(fs);
    if (mode === "root-rename") {
      const root = path.join(config.root, "held-root"); await fs.mkdir(root, { mode: 0o700 });
      for (const entry of config.sources) await fs.copyFile(path.join(config.root, `${entry.file_id}.receipt.json`), path.join(root, `${entry.file_id}.receipt.json`));
      config = { ...config, root };
    }
    const gateFile = path.join(config.root, `${config.sources[0]!.file_id}.receipt.json`);
    let ready!: () => void; const held = new Promise<void>(resolve => { ready = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    let rootStats = 0, fileStats = 0, reads = 0, heldOnce = false, raced = false;
    const paths: string[] = [];
    const hold = async (phase: string) => {
      if (role === "cancel" && phase === phaseOrConfig && !heldOnce) { heldOnce = true; ready(); await pause; }
    };
    const race = async () => {
      if (raced || role !== "race") return; raced = true;
      const body = await oldReadFile(gateFile);
      if (mode === "mutation") { const changed = Buffer.from(body); changed[20] = changed[20] === 97 ? 98 : 97; await writeOriginals.writeFile(gateFile, changed); }
      if (mode === "growth") await writeOriginals.appendFile(gateFile, "x");
      if (mode === "rename") {
        const replacement = path.join(config.root, "publication"); await writeOriginals.writeFile(replacement, body, { mode: 0o600 });
        await writeOriginals.rename(replacement, gateFile);
      }
      if (mode === "file-mode") await writeOriginals.chmod(gateFile, 0o640);
      if (mode === "root-mode") await writeOriginals.chmod(config.root, 0o750);
      if (mode === "root-rename") { await writeOriginals.rename(config.root, `${config.root}-displaced`); await writeOriginals.mkdir(config.root, { mode: 0o700 }); }
    };
    override(fs, "lstat", async (...args: any[]) => {
      record(); paths.push(args[0]);
      if (role === "error") throw Error(`synthetic private source failure ${config.root}`);
      const result = await oldLstat(...args);
      await hold(args[0] === config.root ? "lstat-root" : args[0] === gateFile ? "lstat-file" : "ancestor"); return result;
    });
    override(fs, "open", async (...args: any[]) => {
      record(); paths.push(args[0]); assert.equal(args[1] & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND), 0);
      assert.ok(args[1] & constants.O_NOFOLLOW); assert.ok(args[1] & constants.O_NONBLOCK);
      const handle = await oldOpen(...args); opened++;
      const directory = Boolean(args[1] & constants.O_DIRECTORY); const stat = handle.stat.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.close = async () => { closed++; await close(); await hold("close"); if (mode === "close-error") throw Error("synthetic private close failure"); };
      for (const name of ["write", "writeFile", "appendFile", "truncate", "chmod", "chown", "utimes"]) handle[name] = denyWrite;
      handle.stat = async (...options: any[]) => {
        record(); const result = await stat(...options);
        const phase = directory ? (++rootStats === 1 ? "root-stat" : "final-root") : (++fileStats === 1 ? "file-stat" : "final-file");
        if (!directory && mode === "foreign-owner") result.uid += 1n;
        if (!directory && mode === "socket-stat") { result.isFile = () => false; result.isSocket = () => true; }
        if (directory && rootStats === 2 && mode === "root-rename") await race();
        await hold(phase); return result;
      };
      handle.read = async (...options: any[]) => {
        record(); reads++;
        const result = mode === "partial" && reads > 1 ? { bytesRead: 0 } : await read(options[0], options[1], mode === "partial" ? 1 : options[2], options[3]);
        if (mode !== "root-rename") await race(); await hold("read"); return result;
      };
      await hold(directory ? "root-open" : "file-open"); return handle;
    });
    for (const name of writeNames) override(fs, name, denyWrite);
    syncBuiltinESMExports();
    const { createReceiptFileSources } = await import("@pi-vista/evidence/files");
    const sources = createReceiptFileSources({ ...config, timeout_ms: role === "cancel" && mode === "timeout" ? 100 : 2000 });
    const pending = sources[0]!.read(controller.signal).then(() => role === "read" ? "matched" : "unexpected-success", (error: unknown) => {
      assert.ok(error instanceof EvidenceError); assert.equal(error.stack, `EvidenceError: ${error.code}`); return error.code;
    });
    if (role === "cancel") {
      await Promise.race([held, new Promise<never>((_, reject) => { readinessTimer = setTimeout(() => reject(Error("synthetic readiness deadline")), 4000); })]);
      clearTimeout(readinessTimer);
      if (mode === "abort") controller.abort(); else await new Promise(resolve => setTimeout(resolve, 150));
      cancelled = true; release();
    }
    const code = await pending; assert.equal(code, role === "read" ? "matched" : role === "cancel" && mode === "timeout" ? "evidence-timeout" : "unverified-evidence");
    const allowed = ["/", ...config.root.slice(1).split("/").map((_, i, parts) => `/${parts.slice(0, i + 1).join("/")}`), gateFile];
    assert.ok(paths.every(file => allowed.includes(file)));
    assert.equal(opened, closed); assert.equal(afterCancellation, 0); assert.equal(writes, 0);
    console.log(JSON.stringify({ code, opened, closed, afterCancellation, writes }));
  }
} finally {
  clearTimeout(readinessTimer); release(); deregisterLoader();
  for (const [name, fn] of Object.entries(originals)) fs[name] = fn;
  for (const [name, fn] of Object.entries(syncOriginals)) (syncFs as any)[name] = fn;
  syncBuiltinESMExports();
}
