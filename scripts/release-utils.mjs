import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
export const isMain = (url) => process.argv[1] !== undefined && fileURLToPath(url) === path.resolve(process.argv[1]);
export const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseOptions(args, valueNames = [], flagNames = ["network"]) {
  const options = { network: false }, seen = new Set();
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
    if (!match || seen.has(match[1])) throw new Error(`Invalid or duplicate option: ${arg}`);
    const [, key, value] = match;
    seen.add(key);
    if (flagNames.includes(key) && value === undefined) options[key] = true;
    else if (valueNames.includes(key) && value !== undefined) options[key] = value;
    else throw new Error(`Unsupported option: ${arg}`);
  }
  return options;
}

export function validatePackageName(name) {
  if (typeof name !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error("Invalid package name");
  return name;
}

export function buildOrder(packages) {
  const byName = new Map(packages.map((pkg) => [validatePackageName(pkg.manifest.name), pkg]));
  if (byName.size !== packages.length) throw new Error("Duplicate workspace name");
  const order = [], active = new Set(), done = new Set();
  function visit(pkg) {
    const name = pkg.manifest.name;
    if (active.has(name)) throw new Error(`Workspace dependency cycle: ${name}`);
    if (done.has(name)) return;
    active.add(name);
    const dependencies = { ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies, ...pkg.manifest.peerDependencies, ...pkg.manifest.optionalDependencies };
    for (const dependency of Object.keys(dependencies).sort()) if (byName.has(dependency)) visit(byName.get(dependency));
    active.delete(name);
    done.add(name);
    order.push(pkg);
  }
  for (const pkg of [...packages].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, "en"))) visit(pkg);
  return order;
}

export async function discoverPackages(root = ROOT) {
  const manifest = await readJson(path.join(root, "package.json"));
  if (!Array.isArray(manifest.workspaces) || !manifest.workspaces.length) throw new Error("Missing workspace inventory");
  const directories = new Set();
  for (const pattern of manifest.workspaces) {
    // The source contract uses directory workspaces, not arbitrary shell/glob expansion.
    if (typeof pattern !== "string" || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*(?:\/\*)?$/.test(pattern)) throw new Error("Unsupported workspace directory pattern");
    if (pattern.endsWith("/*")) {
      const parent = path.join(root, pattern.slice(0, -2));
      if (!(await lstat(parent)).isDirectory() || (await lstat(parent)).isSymbolicLink()) throw new Error("Workspace parent must be a real directory");
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error("Symlink workspace refused");
        if (entry.isDirectory()) directories.add(path.join(parent, entry.name));
      }
    } else directories.add(path.join(root, pattern));
  }
  const packages = [];
  for (const directory of [...directories].sort()) {
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error("Workspace must be a real directory");
    const packageManifest = await readJson(path.join(directory, "package.json"));
    validatePackageName(packageManifest.name);
    packages.push({ directory, manifest: packageManifest });
  }
  return buildOrder(packages);
}

function safeTarget(target) {
  if (typeof target !== "string" || !target.startsWith("./dist/") || !allowedPackagePath(target.slice(2))) throw new Error("Public target outside compiled-content allowlist");
  return target.slice(2);
}

export function publicEntrypoints(manifest) {
  validatePackageName(manifest.name);
  const exports = manifest.exports;
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) throw new Error("Expected explicit public export map");
  const entries = [];
  for (const [subpath, target] of Object.entries(exports)) {
    if (!/^\.(?:\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/.test(subpath)) throw new Error("Unsupported public export subpath (wildcards/conditions need explicit gate support)");
    if (target === null) continue;
    if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).some((key) => !["types", "import", "require", "default"].includes(key))) throw new Error("Expected types and explicit runtime export conditions");
    const types = safeTarget(target.types);
    const runtime = safeTarget(target.import ?? target.default ?? target.require);
    if (!types.endsWith(".d.ts") || !/\.[mc]?js$/.test(runtime)) throw new Error("Export requires declarations and JavaScript");
    entries.push({ specifier: manifest.name + (subpath === "." ? "" : subpath.slice(1)), types, runtime, ...(target.require ? { require: safeTarget(target.require) } : {}) });
  }
  if (!entries.length) throw new Error("No public exports");
  return entries;
}

export function publicBins(manifest) {
  if (manifest.bin === undefined) return [];
  if (!manifest.bin || typeof manifest.bin !== "object" || Array.isArray(manifest.bin)) throw new Error("Expected explicit public bin map");
  return Object.entries(manifest.bin).map(([name, target]) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error("Unsafe bin name");
    const file = safeTarget(target);
    if (!/\.[mc]?js$/.test(file)) throw new Error("Bin must be compiled JavaScript");
    return { name, file };
  });
}

export function allowedPackagePath(file) {
  if (["package.json", "README.md", "LICENSE"].includes(file)) return true;
  if (typeof file !== "string" || !/^dist\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\.d\.ts(?:\.map)?|\.[mc]?js(?:\.map)?)$/.test(file)) return false;
  if (file.split("/").some((part) => ["src", "test", "tests", "__tests__", "fixtures", "tmp", "keys", "internal"].includes(part))) return false;
  return !/(?:^|\/|\.)(?:test|spec)(?:\.|\/)/.test(file);
}

export function validateInventory(manifest, files) {
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error("Empty or duplicate package inventory");
  for (const file of files) if (!allowedPackagePath(file)) throw new Error(`Disallowed package content: ${file}`);
  for (const required of ["package.json", ...publicEntrypoints(manifest).flatMap((entry) => [entry.types, entry.runtime, ...(entry.require ? [entry.require] : [])]), ...publicBins(manifest).map((bin) => bin.file)]) {
    if (!files.includes(required)) throw new Error(`Missing public package target: ${required}`);
  }
  return files;
}

export function validateContent(file, text) {
  // Bounded payload checks, deliberately not a universal credential detector.
  if (/-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text)) throw new Error(`Private-key marker in packed content: ${file}`);
  if (file.endsWith(".map")) {
    const map = JSON.parse(text);
    if (map.sourcesContent !== undefined && (!Array.isArray(map.sourcesContent) || map.sourcesContent.some((source) => source !== null && source !== ""))) throw new Error(`Embedded source content in packed map: ${file}`);
  }
}

export function validateInstalledLock(sourceLock, installedLock, packages, tarballPaths, consumerDirectory, tarballIntegrities) {
  const expected = new Map(packages.map((pkg, index) => [pkg.manifest.name, { version: pkg.manifest.version, tarball: tarballPaths[index], integrity: tarballIntegrities[index] }]));
  for (const [location, entry] of Object.entries(installedLock.packages ?? {})) {
    if (location === "") continue;
    if (entry.link || !location.startsWith("node_modules/")) throw new Error("Consumer contains a workspace link or unexpected lock entry");
    const name = location.slice("node_modules/".length);
    if (expected.has(name)) {
      const pkg = expected.get(name);
      if (entry.version !== pkg.version || entry.integrity !== pkg.integrity || typeof entry.resolved !== "string" || !entry.resolved.startsWith("file:") || path.resolve(consumerDirectory, entry.resolved.slice(5)) !== pkg.tarball) throw new Error(`Consumer is not using exact packed tarball: ${name}`);
    } else {
      const locked = sourceLock.packages[location];
      if (!locked || entry.version !== locked.version || entry.integrity !== locked.integrity) throw new Error(`Consumer dependency differs from source lock: ${name}`);
    }
  }
  for (const name of expected.keys()) if (!installedLock.packages?.[`node_modules/${name}`]) throw new Error(`Consumer missing packed package: ${name}`);
  for (const name of ["typescript", "@types/node"]) if (!installedLock.packages?.[`node_modules/${name}`]) throw new Error(`Consumer missing locked compiler dependency: ${name}`);
}

export async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Non-regular package/test entry refused: ${relative}`);
  }
  return files;
}

export async function createRunDirectory(label, root = ROOT) {
  let parent = root;
  for (const component of ["tmp", "release-contract"]) {
    parent = path.join(parent, component);
    await mkdir(parent, { recursive: true });
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Artifact directory must not be a symlink");
  }
  return mkdtemp(path.join(parent, `${label}-`));
}

export async function npmCli() {
  const candidates = [process.env.npm_execpath, path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) candidates.push(path.join(directory, "npm"));
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const resolved = await realpath(candidate);
      if (resolved.endsWith("npm-cli.js")) { await access(resolved); return resolved; }
    } catch { /* Try the next ordinary npm installation. */ }
  }
  throw new Error("Provide npm via PATH or npm_execpath; no global installation is performed");
}

export function commandEnvironment() {
  // Public dependency-cache/tool lookup only; never forward arbitrary host credential state.
  const env = { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`, LANG: "C", LC_ALL: "C", NODE_PATH: "", NPM_CONFIG_USERCONFIG: "/dev/null" };
  for (const key of ["HOME", "npm_config_cache", "NPM_CONFIG_CACHE", "npm_execpath"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

export function npmFlags(runDirectory, network) {
  return ["--ignore-scripts", "--no-audit", "--no-fund", "--userconfig=/dev/null", `--globalconfig=${path.join(runDirectory, "empty-global.npmrc")}`, "--registry=https://registry.npmjs.org", `--logs-dir=${path.join(runDirectory, "npm-logs")}`, ...(network ? [] : ["--offline"])];
}

export async function runLogged(directory, label, executable, args, cwd = ROOT) {
  const log = path.join(directory, `${label}.log`);
  const description = JSON.stringify([executable, ...args]);
  const temporary = path.join(directory, "process-tmp");
  await mkdir(temporary, { recursive: true });
  try {
    const result = await execFileAsync(executable, args, { cwd, env: { ...commandEnvironment(), TMPDIR: temporary }, shell: false, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" });
    await writeFile(log, `${description}\nexit: 0\n${result.stdout}\n${result.stderr}`);
    console.log(`PASS ${label} (${log})`);
    return result;
  } catch (error) {
    await writeFile(log, `${description}\nexit: ${error.code ?? "unknown"}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`);
    throw new Error(`FAILED ${label}; see ${log}`, { cause: error });
  }
}

export async function validateLockedCompiler(root = ROOT) {
  const lock = await readJson(path.join(root, "package-lock.json"));
  const compiler = await readJson(path.join(root, "node_modules/typescript/package.json"));
  if (compiler.version !== lock.packages?.["node_modules/typescript"]?.version) throw new Error("Installed TypeScript differs from source lock");
  return lock;
}

export async function writeReport(directory, report) {
  await writeFile(path.join(directory, "report.json"), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, ...report }, null, 2) + "\n");
}
