import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, types } from "node:util";
import { ROOT, commandEnvironment, discoverPackages, listFiles, npmCli, npmFlags } from "./release-utils.mjs";

const exec = promisify(execFile), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const refuse = () => { throw Error("pi-local-observer-release-refused"); };
function own(value, keys) {
  if (types.isProxy(value) || !value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refuse();
  const out = Object.create(null);
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(value, key); if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refuse(); out[key] = p.value; }
  return out;
}
function absolute(value) { if (typeof value !== "string" || !isAbsolute(value) || normalize(value) !== value || /[\x00-\x1f\x7f]/u.test(value)) refuse(); return value; }
/** Pure fixed loader source. Missing/mismatched entry is diagnostic-only.
 * No model/prompt/tool/permission API exists here; the reviewed observer factory
 * alone owns its notification hooks. A hash is integrity, not Owner identity.
 */
export function piLocalObserverLoader(input) {
  const v = own(input, ["entry", "manifest_sha256"]), entry = absolute(v.entry);
  if (typeof v.manifest_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(v.manifest_sha256)) refuse();
  const manifest = join(dirname(entry), "manifest.json");
  return `import { readFile } from "node:fs/promises";\nimport { createHash } from "node:crypto";\nimport { dirname, join } from "node:path";\nexport default async function (pi) {\n  try {\n    const manifestFile = ${JSON.stringify(manifest)};\n    const bytes = await readFile(manifestFile);\n    if (createHash("sha256").update(bytes).digest("hex") !== ${JSON.stringify(v.manifest_sha256)}) throw Error("observer-artifact-drift");\n    const manifest = JSON.parse(bytes);\n    for (const row of manifest.files) {\n      const content = await readFile(join(dirname(manifestFile), row.path));\n      if (createHash("sha256").update(content).digest("hex") !== row.sha256) throw Error("observer-artifact-drift");\n    }\n    const module = await import(${JSON.stringify(pathToFileURL(entry).href)});\n    if (typeof module.default !== "function") throw Error("observer-entry-unavailable");\n    return await module.default(pi);\n  } catch { try { console.error("[pi-vista] local observer entry unavailable"); } catch {} }\n}\n`; 
}
/** Explicit source-bound builder, no publication/default activation. The caller
 * decides the release directory and later installs the loader. No host Pi SDK is
 * copied or npm-installed; exact local @pi-vista tarballs provide runtime deps.
 */
export async function buildPiLocalObserverRelease(input) {
  const v = own(input, ["source_sha", "destination"]), destination = absolute(v.destination);
  if (typeof v.source_sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(v.source_sha)) refuse();
  const env = commandEnvironment(), run = (command, args) => exec(command, args, { cwd: ROOT, env, shell: false, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const check = async () => {
    if ((await run("git", ["rev-parse", "HEAD"])).stdout.trim() !== v.source_sha || (await run("git", ["status", "--porcelain=v1", "--untracked-files=normal"])).stdout.trim()) refuse();
  };
  await check();
  const parent = dirname(destination), parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || await realpath(parent) !== parent ||
      parentStat.uid !== process.getuid?.() || (parentStat.mode & 0o022) !== 0) refuse();
  // mkdir without recursive/exist tolerance atomically reserves this fresh path.
  // Existing releases, symlink parents and other owners' directories are refused.
  await mkdir(destination, { mode: 0o700 });
  const npm = await npmCli(), source = join(destination, "source"), archives = [];
  await writeFile(join(destination, "empty-global.npmrc"), "", { flag: "wx", mode: 0o600 });
  const flags = npmFlags(destination, false);
  await mkdir(source, { mode: 0o700 });
  const archive = join(destination, "source.tar");
  await run("git", ["archive", "--format=tar", `--output=${archive}`, v.source_sha]);
  await run("tar", ["-xf", archive, "-C", source]);
  const sourceRun = args => exec(process.execPath, [npm, ...args], { cwd: source, env, shell: false, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  await sourceRun([...flags, "ci"]);
  await sourceRun([...flags, "run", "build"]);
  const packages = await discoverPackages(source), names = new Set(packages.map(pkg => pkg.manifest.name));
  if (packages.length !== 11 || packages.some(pkg => !pkg.manifest.name.startsWith("@pi-vista/") ||
      ["dependencies", "optionalDependencies", "peerDependencies"].some(key => Object.keys(pkg.manifest[key] ?? {}).some(name => !names.has(name))))) refuse();
  for (const pkg of packages) {
    const packed = await sourceRun([...flags, "pack", "--json", "--workspace", pkg.manifest.name, "--pack-destination", destination]);
    const rows = JSON.parse(packed.stdout); if (rows.length !== 1 || typeof rows[0].filename !== "string" || rows[0].filename.includes("/")) refuse();
    const file = join(destination, rows[0].filename); archives.push({ name: pkg.manifest.name, file, sha256: sha(await readFile(file)) });
  }
  await writeFile(join(destination, "package.json"), JSON.stringify({ private: true, type: "module", name: "pi-vista-local-observer-runtime" }), { mode: 0o600, flag: "wx" });
  await exec(process.execPath, [npm, ...flags, "install", "--omit=dev", "--package-lock=false", ...archives.map(a => a.file)], { cwd: destination, env, shell: false, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const entry = join(destination, "pi-local-observer.mjs"), bytes = await readFile(join(source, "scripts/pi-local-observer.mjs"));
  await writeFile(entry, bytes, { mode: 0o600, flag: "wx" });
  const files = [{ path: "pi-local-observer.mjs", sha256: sha(bytes) },
    { path: "package.json", sha256: sha(await readFile(join(destination, "package.json"))) }];
  for (const pkg of packages) {
    const installed = join(destination, "node_modules", pkg.manifest.name);
    files.push({ path: `node_modules/${pkg.manifest.name}/package.json`, sha256: sha(await readFile(join(installed, "package.json"))) });
    for (const relative of await listFiles(join(installed, "dist"))) {
      if (!/\.(?:[mc]?js|json)$/u.test(relative)) continue;
      files.push({ path: `node_modules/${pkg.manifest.name}/dist/${relative}`, sha256: sha(await readFile(join(installed, "dist", relative))) });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const manifest = { schema: "pi-local-observer-runtime/1", source_sha: v.source_sha, entry_sha256: sha(bytes), packages: archives.map(a => ({ name: a.name, tarball_sha256: a.sha256 })), files,
    host_sdk_bundled: false, bank_access: false, model_access: false, authorization: "none", executable: false };
  const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(join(destination, "manifest.json"), manifestBytes, { mode: 0o600, flag: "wx" });
  await check();
  // Own fresh archive/build tree only; the immutable source.tar and local
  // runtime tarballs/manifest remain for audit and rollback.
  await rm(source, { recursive: true, force: false });
  return Object.freeze({ entry, manifest: Object.freeze(manifest), manifest_sha256: sha(manifestBytes) });
}
