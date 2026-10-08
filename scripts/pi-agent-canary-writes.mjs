import fs from "node:fs";
import promises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { CanaryError } from "./pi-agent-canary-support.mjs";

/** Isolated CLI-process control for trusted SDK standard Node file APIs, not an OS/hostile-native sandbox. */
export function trialWriteBoundary(directory) {
  const root = path.resolve(directory); const undo = []; const counts = { permittedOperations: 0, blockedOperations: 0 };
  function check(value) {
    const filename = value instanceof URL ? fileURLToPath(value) : typeof value === "string" ? value : undefined;
    if (filename === undefined || !path.resolve(filename).startsWith(`${root}${path.sep}`)) {
      counts.blockedOperations++; throw new CanaryError("unsafe-path");
    }
    counts.permittedOperations++;
  }
  function mutating(flags) {
    return typeof flags === "string" ? /[wa+]/.test(flags) : typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0;
  }
  for (const object of [fs, promises]) {
    for (const name of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "rmdir", "truncate", "chmod", "chown", "copyFile", "symlink", "link", "cp"]) {
      const original = object[name]; if (typeof original !== "function") continue;
      object[name] = function (...args) {
        if (["rename", "copyFile", "link", "cp"].includes(name)) { check(args[0]); check(args[1]); }
        else if (name === "symlink") { check(args[0]); check(args[1]); }
        else check(args[0]);
        return original.apply(this, args);
      };
      undo.push(() => { object[name] = original; });
    }
    const original = object.open;
    object.open = function (filename, flags, ...rest) { if (mutating(flags)) check(filename); return original.call(this, filename, flags, ...rest); };
    undo.push(() => { object.open = original; });
  }
  for (const name of ["writeFileSync", "appendFileSync", "mkdirSync", "unlinkSync", "rmSync", "rmdirSync", "truncateSync", "chmodSync", "chownSync"]) {
    const original = fs[name]; fs[name] = function (filename, ...rest) { check(filename); return original.call(this, filename, ...rest); };
    undo.push(() => { fs[name] = original; });
  }
  for (const name of ["renameSync", "copyFileSync", "linkSync", "symlinkSync", "cpSync"]) {
    const original = fs[name]; fs[name] = function (source, target, ...rest) { check(source); check(target); return original.call(this, source, target, ...rest); };
    undo.push(() => { fs[name] = original; });
  }
  const originalStream = fs.createWriteStream;
  fs.createWriteStream = function (filename, ...rest) { check(filename); return originalStream.call(this, filename, ...rest); };
  undo.push(() => { fs.createWriteStream = originalStream; });
  const originalOpen = fs.openSync;
  fs.openSync = function (filename, flags, ...rest) { if (mutating(flags)) check(filename); return originalOpen.call(this, filename, flags, ...rest); };
  undo.push(() => { fs.openSync = originalOpen; });
  syncBuiltinESMExports(); let restored = false;
  return { counts, restore() { if (restored) return; restored = true; for (const restore of undo.reverse()) restore(); syncBuiltinESMExports(); } };
}
