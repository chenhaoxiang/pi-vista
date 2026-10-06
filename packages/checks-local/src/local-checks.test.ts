import { deepStrictEqual, match, rejects, strictEqual } from "node:assert/strict";
import { createHash } from "node:crypto";
import childProcess, { type ChildProcess, type ExecFileOptions } from "node:child_process";
import fs from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { CheckError, CheckRegistry, type CheckReport } from "@pi-vista/checks";
import type { CheckFunctionType, VistaCheckFunction } from "@pi-vista/protocol";
// Exercise the package's public built entrypoint, not a separate source registry.
import {
  createLocalCheckRegistry, LocalCheckError, GIT_MAX_BUFFER, GIT_TIMEOUT_MS,
  MAX_ROOTS, MAX_SUBJECTS, type LocalCheckConfig,
} from "@pi-vista/checks-local";

const GIT = "/usr/bin/git";
const TMP = fileURLToPath(new URL("../../../tmp/", import.meta.url));
const SETUP_ENV = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function setupGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(GIT, ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
      { cwd, env: { ...SETUP_ENV }, timeout: 5_000, maxBuffer: GIT_MAX_BUFFER, shell: false },
      (error, stdout) => error === null ? resolve(stdout.trim()) : reject(error));
  });
}

type MutableConfig = {
  roots: Record<string, string>;
  repositories: Record<string, { root: string; relativePath: string }>;
  targets: Record<string, { root: string; relativePath: string }>;
  branches: Record<string, { repo: string; ref: string }>;
  gitExecutable: string;
};
interface Fixture { base: string; repo: string; head: string; config: MutableConfig }

async function fixture(t: TestContext): Promise<Fixture> {
  await fs.mkdir(TMP, { recursive: true });
  const base = await fs.realpath(await fs.mkdtemp(join(TMP, "checks-local-")));
  // Cleanup owns exactly this mkdtemp directory, never a store or shared repo.
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = join(base, "repository");
  await fs.mkdir(repo);
  await setupGit(repo, ["init", "-b", "primary"]);
  await setupGit(repo, ["config", "user.name", "Synthetic Fixture"]);
  await setupGit(repo, ["config", "user.email", "fixture@example.invalid"]);
  await fs.writeFile(join(repo, "seed.txt"), "synthetic seed\n");
  await setupGit(repo, ["add", "--", "seed.txt"]);
  await setupGit(repo, ["commit", "-m", "synthetic fixture"]);
  const head = await setupGit(repo, ["rev-parse", "HEAD"]);
  return {
    base, repo, head,
    config: {
      roots: { area: base }, repositories: { sample: { root: "area", relativePath: "repository" } },
      targets: {
        seed: { root: "area", relativePath: "repository/seed.txt" },
        missing: { root: "area", relativePath: "repository/absent/leaf.txt" },
        directory: { root: "area", relativePath: "repository" },
        root: { root: "area", relativePath: "." },
      },
      branches: {
        primary: { repo: "sample", ref: "refs/heads/primary" },
        absent: { repo: "sample", ref: "refs/heads/absent" },
        topic: { repo: "sample", ref: "refs/heads/topic" },
        child: { repo: "sample", ref: "refs/heads/topic/child" },
      }, gitExecutable: GIT,
    },
  };
}

function definition(type: CheckFunctionType, params: Record<string, string>, on_fail: "STOP" | "WARN" = "STOP", check_id = "local-check"): VistaCheckFunction {
  return { check_id, type, params, on_fail };
}

function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
async function inventory(root: string): Promise<string> {
  const entries: unknown[] = [];
  const visit = async (path: string): Promise<void> => {
    const stat = await fs.lstat(path);
    const name = relative(root, path);
    if (stat.isSymbolicLink()) entries.push([name, "link", stat.mode, stat.mtimeMs, await fs.readlink(path)]);
    else if (stat.isDirectory()) {
      entries.push([name, "directory", stat.mode, stat.mtimeMs]);
      for (const entry of (await fs.readdir(path)).sort()) await visit(join(path, entry));
    } else entries.push([name, "file", stat.mode, stat.mtimeMs, digest(await fs.readFile(path))]);
  };
  await visit(root);
  return digest(JSON.stringify(entries));
}

async function readOnly<T>(f: Fixture, body: () => Promise<T>): Promise<T> {
  const before = await inventory(f.base);
  const indexBefore = digest(await fs.readFile(join(f.repo, ".git/index")));
  const result = await body();
  strictEqual(await inventory(f.base), before, "full working/Git directory inventory, modes, mtimes and file hashes stable");
  strictEqual(digest(await fs.readFile(join(f.repo, ".git/index"))), indexBefore, "full index hash stable");
  return result;
}
async function probe(f: Fixture, registry: CheckRegistry, type: CheckFunctionType, params: Record<string, string>, onFail: "STOP" | "WARN" = "STOP"): Promise<CheckReport> {
  return readOnly(f, () => registry.run([definition(type, params, onFail)], {}, { timeoutMs: 2_000 }));
}
function verdict(report: CheckReport, expected: boolean): void {
  strictEqual(report.verification, "predicate-only");
  strictEqual(report.authorization, "none");
  strictEqual(report.satisfied, expected);
  strictEqual(report.results[0]?.reason, expected ? "predicate-true" : "predicate-false");
}
function hardFailure(report: CheckReport): void {
  strictEqual(report.satisfied, false);
  strictEqual(report.results[0]?.status, "failed");
  strictEqual(report.results[0]?.reason, "handler-threw");
}

test("six public local handlers observe actual filesystem, HEAD, full branches and clean status without writes", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  for (const subject of ["seed", "directory", "root"]) verdict(await probe(f, registry, "path_exists", { subject }), true);
  verdict(await probe(f, registry, "path_exists", { subject: "missing" }), false);
  verdict(await probe(f, registry, "path_not_exists", { subject: "missing" }), true);
  verdict(await probe(f, registry, "path_not_exists", { subject: "seed" }), false);
  verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected: f.head.toUpperCase() }), true);
  for (const expected of ["a".repeat(40), "b".repeat(64)]) verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected }), false);
  verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "primary" }), true);
  verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "absent" }), false);
  verdict(await probe(f, registry, "branch_not_exists", { repo: "sample", subject: "absent" }), true);
  verdict(await probe(f, registry, "branch_not_exists", { repo: "sample", subject: "primary" }), false);
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
  const report = await readOnly(f, () => registry.run([definition("path_exists", { subject: "{task}" })], { task: "seed" }));
  verdict(report, true);
  t.diagnostic(JSON.stringify({ actualHandlers: 6, readonlyInventory: await inventory(f.base), indexSha256: digest(await fs.readFile(join(f.repo, ".git/index"))), authority: "none" }));
});

test("filesystem additions/removals, exact branch namespace and HEAD mutation never reuse a cached pass", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  await fs.rm(join(f.repo, "seed.txt"));
  verdict(await probe(f, registry, "path_exists", { subject: "seed" }), false);
  verdict(await probe(f, registry, "path_not_exists", { subject: "seed" }), true);
  await fs.writeFile(join(f.repo, "seed.txt"), "synthetic changed\n");
  verdict(await probe(f, registry, "path_exists", { subject: "seed" }), true);
  await setupGit(f.repo, ["tag", "absent"]);
  verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "absent" }), false);
  await setupGit(f.repo, ["branch", "topic/child"]);
  verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "topic" }), false);
  verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "child" }), true);
  await setupGit(f.repo, ["branch", "absent"]);
  verdict(await probe(f, registry, "branch_not_exists", { repo: "sample", subject: "absent" }), false);
  await setupGit(f.repo, ["branch", "-D", "absent"]);
  verdict(await probe(f, registry, "branch_not_exists", { repo: "sample", subject: "absent" }), true);
  await setupGit(f.repo, ["add", "--", "seed.txt"]);
  await setupGit(f.repo, ["commit", "-m", "synthetic mutation"]);
  verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected: f.head }), false);
  verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected: await setupGit(f.repo, ["rev-parse", "HEAD"]) }), true);
});

test("cleanliness includes tracked unstaged, staged, index-only and untracked dirt; ignored files are excluded", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  await fs.writeFile(join(f.repo, "seed.txt"), "synthetic dirt\n");
  const dirty = await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN");
  verdict(dirty, false);
  strictEqual(dirty.results[0]?.status, "warning");
  await setupGit(f.repo, ["add", "--", "seed.txt"]);
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), false);
  await fs.writeFile(join(f.repo, "seed.txt"), "synthetic seed\n");
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), false);
  await setupGit(f.repo, ["add", "--", "seed.txt"]);
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
  await fs.writeFile(join(f.repo, "untracked.txt"), "synthetic untracked\n");
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), false);
  await fs.rm(join(f.repo, "untracked.txt"));
  await fs.writeFile(join(f.repo, ".git/info/exclude"), "ignored.txt\n");
  await fs.writeFile(join(f.repo, "ignored.txt"), "synthetic ignored\n");
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
  await fs.rm(join(f.repo, "seed.txt"));
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), false);
});

test("type-specific unknown aliases and schemas fail hard even WARN with zero filesystem reads or spawns", async (t) => {
  const f = await fixture(t);
  f.config.repositories.other = { root: "area", relativePath: "other" };
  f.config.branches.foreign = { repo: "other", ref: "refs/heads/primary" };
  const registry = await createLocalCheckRegistry(f.config);
  let reads = 0;
  let spawns = 0;
  const lstat = t.mock.method(fs, "lstat", () => { reads += 1; throw new Error("unexpected read"); });
  const realpath = t.mock.method(fs, "realpath", () => { reads += 1; throw new Error("unexpected read"); });
  const exec = t.mock.method(childProcess, "execFile", () => { spawns += 1; throw new Error("unexpected spawn"); });
  try {
    const cases: [CheckFunctionType, Record<string, string>][] = [
      ["path_exists", {}], ["path_not_exists", { subject: "unknown" }], ["path_exists", { subject: "seed", repo: "sample" }],
      ["sha_matches", { repo: "unknown", expected: f.head }], ["sha_matches", { repo: "sample", expected: "not-a-sha" }],
      ["sha_matches", { repo: "sample", expected: f.head, actual: f.head }],
      ["branch_exists", { repo: "sample", subject: "unknown" }], ["branch_not_exists", { repo: "sample", subject: "foreign" }],
      ["branch_exists", { repo: "sample" }], ["worktree_clean", { repo: "sample", subject: "seed" }], ["worktree_clean", { repo: "unknown" }],
    ];
    for (const [type, params] of cases) {
      const report = await registry.run([definition(type, params, "WARN"), definition("path_exists", { subject: "seed" }, "STOP", "later")]);
      hardFailure(report);
      strictEqual(report.results[1]?.reason, "stopped");
    }
    strictEqual(reads, 0);
    strictEqual(spawns, 0);
    t.diagnostic(JSON.stringify({ schemaAliasCases: cases.length, ownReads: reads, spawns, warnInfrastructureFailure: "hard" }));
  } finally { lstat.mock.restore(); realpath.mock.restore(); exec.mock.restore(); }
});

test("private config and alias maps reject hostile descriptors with zero getters, proxy traps, coercions or I/O", async (t) => {
  const f = await fixture(t);
  let getters = 0;
  let traps = 0;
  let coercions = 0;
  let io = 0;
  const lstat = t.mock.method(fs, "lstat", () => { io += 1; throw new Error("unexpected read"); });
  const exec = t.mock.method(childProcess, "execFile", () => { io += 1; throw new Error("unexpected spawn"); });
  const proxy = new Proxy({}, { ownKeys() { traps += 1; return []; }, getPrototypeOf() { traps += 1; return null; }, get() { traps += 1; return undefined; } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const getter = Object.defineProperty({}, "roots", { get() { getters += 1; return {}; } });
  const symbol = { ...f.config, [Symbol("private")]: "private" };
  const coerce = { toString() { coercions += 1; return f.base; } };
  const bad: unknown[] = [null, [], proxy, revoked.proxy, getter, symbol, { ...f.config, extra: "private" },
    { ...f.config, roots: proxy }, { ...f.config, targets: revoked.proxy }, { ...f.config, branches: [] },
    { ...f.config, roots: { area: coerce } }, { ...f.config, gitExecutable: coerce },
    { ...f.config, roots: { area: f.base, [Symbol("private")]: f.base } },
    { ...f.config, repositories: { sample: { root: "area", relativePath: "repository", extra: "private" } } },
    { ...f.config, targets: { seed: Object.defineProperty({}, "root", { get() { getters += 1; return "area"; } }) } },
    { ...f.config, branches: { primary: proxy } }, { ...f.config, roots: Object.create({ area: f.base }) },
    { ...f.config, targets: { seed: { root: "area", relativePath: undefined } } },
  ];
  try {
    for (const config of bad) await rejects(createLocalCheckRegistry(config as LocalCheckConfig), (error: unknown) => {
      strictEqual(error instanceof LocalCheckError, true);
      strictEqual((error as LocalCheckError).code, "invalid-config");
      strictEqual((error as Error).stack, "LocalCheckError: invalid local check configuration");
      return true;
    });
    deepStrictEqual([getters, traps, coercions, io], [0, 0, 0, 0]);
    t.diagnostic(JSON.stringify({ hostileConfigCases: bad.length, getters, proxyTraps: traps, coercions, io }));
  } finally { lstat.mock.restore(); exec.mock.restore(); }
});

test("config rejects lexical traversal, absolute/drive/URI paths, malformed refs, unsafe aliases and resource excess before I/O", async (t) => {
  const f = await fixture(t);
  let io = 0;
  const lstat = t.mock.method(fs, "lstat", () => { io += 1; throw new Error("unexpected read"); });
  const exec = t.mock.method(childProcess, "execFile", () => { io += 1; throw new Error("unexpected spawn"); });
  try {
    const paths = ["", "../outside", "repository/../seed.txt", "/absolute", "C:/drive", "file://target", "repository\\seed", "repository//seed", "repository/./seed", "x/".repeat(33) + "leaf", "x".repeat(129), "\0"];
    for (const relativePath of paths) await rejects(createLocalCheckRegistry({ ...f.config, targets: { seed: { root: "area", relativePath } } }), LocalCheckError);
    for (const ref of ["primary", "refs/tags/primary", "refs/heads/", "refs/heads/a..b", "refs/heads/a.lock", "refs/heads/-flag", "refs/heads/a@{x}", "refs/heads/a/"]) {
      await rejects(createLocalCheckRegistry({ ...f.config, branches: { primary: { repo: "sample", ref } } }), LocalCheckError);
    }
    for (const alias of ["git", "../alias", "constructor", "ghp_" + "z".repeat(20), "0".repeat(129), "-alias"]) {
      await rejects(createLocalCheckRegistry({ ...f.config, targets: { [alias]: { root: "area", relativePath: "repository" } } }), LocalCheckError);
    }
    for (const config of [
      { ...f.config, roots: {} }, { ...f.config, roots: { area: f.base + "/../outside" } },
      { ...f.config, roots: { area: "/" } }, { ...f.config, gitExecutable: "git" },
      { ...f.config, targets: { seed: { root: "unknown", relativePath: "." } } },
      { ...f.config, branches: { primary: { repo: "unknown", ref: "refs/heads/primary" } } },
      { ...f.config, roots: Object.fromEntries(Array.from({ length: MAX_ROOTS + 1 }, (_, i) => [`area-${i}`, f.base])) },
      { ...f.config, targets: Object.fromEntries(Array.from({ length: MAX_SUBJECTS + 1 }, (_, i) => [`subject-${i}`, { root: "area", relativePath: "." }])) },
    ]) await rejects(createLocalCheckRegistry(config), LocalCheckError);
    strictEqual(io, 0);
    t.diagnostic(JSON.stringify({ lexicalPathCases: paths.length, io }));
  } finally { lstat.mock.restore(); exec.mock.restore(); }
});

test("protocol hostile params and forbidden path/command keys retain base zero-trap, zero-I/O prevalidation", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  let traps = 0;
  let getters = 0;
  let io = 0;
  const proxy = new Proxy({}, { ownKeys() { traps += 1; return []; }, get() { traps += 1; return "seed"; } });
  const params = Object.defineProperty({}, "subject", { get() { getters += 1; return "seed"; } });
  const lstat = t.mock.method(fs, "lstat", () => { io += 1; throw new Error("unexpected read"); });
  const exec = t.mock.method(childProcess, "execFile", () => { io += 1; throw new Error("unexpected spawn"); });
  try {
    for (const input of [proxy, params, { subject: "seed", [Symbol("secret")]: "secret" }, { subject: { toString() { getters += 1; return "seed"; } } }]) {
      await rejects(registry.run([definition("path_exists", input as Record<string, string>)]), CheckError);
    }
    for (const key of ["path", "cwd", "command", "argv", "revision", "shell"]) {
      const input = { subject: "seed", [key]: "safe-label" };
      try {
        const report = await registry.run([definition("path_exists", input, "WARN")]);
        hardFailure(report); // safe but unknown keys still fail the local exact schema
      } catch (error) { strictEqual(error instanceof CheckError, true); }
    }
    deepStrictEqual([traps, getters, io], [0, 0, 0]);
  } finally { lstat.mock.restore(); exec.mock.restore(); }
});

test("detached own-data config survives mutation during factory validation and an ongoing probe", async (t) => {
  const f = await fixture(t);
  const pending = createLocalCheckRegistry(f.config);
  f.config.targets.seed!.relativePath = "absent";
  f.config.roots.area = join(f.base, "missing");
  f.config.branches.primary!.ref = "refs/heads/absent";
  f.config.repositories.sample!.relativePath = "absent";
  f.config.gitExecutable = join(f.base, "missing-executable");
  const registry = await pending;
  verdict(await probe(f, registry, "path_exists", { subject: "seed" }), true);
  verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "primary" }), true);
  const original = fs.lstat;
  let entered!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { resume = resolve; });
  const lstat = t.mock.method(fs, "lstat", async (...args: Parameters<typeof fs.lstat>) => {
    entered(); await held; return original(...args);
  });
  try {
    const running = registry.run([definition("path_exists", { subject: "seed" })]);
    await started;
    f.config.targets = {};
    f.config.roots = {};
    resume();
    verdict(await running, true);
  } finally { resume(); lstat.mock.restore(); }
  strictEqual(Object.isFrozen(f.config), false);
});

for (const mode of ["leaf", "ancestor", "dangling"] as const) {
  test(`target ${mode} symlink is refused rather than followed or counted missing`, async (t) => {
    const f = await fixture(t);
    await fs.mkdir(join(f.base, "outside"));
    await fs.writeFile(join(f.base, "outside/secret.txt"), "synthetic outside\n");
    const link = join(f.repo, "link");
    await fs.symlink(mode === "dangling" ? join(f.base, "nonexistent") : mode === "ancestor" ? join(f.base, "outside") : join(f.base, "outside/secret.txt"), link);
    f.config.targets.link = { root: "area", relativePath: mode === "ancestor" ? "repository/link/secret.txt" : "repository/link" };
    const registry = await createLocalCheckRegistry(f.config);
    for (const type of ["path_exists", "path_not_exists"] as const) hardFailure(await probe(f, registry, type, { subject: "link" }, "WARN"));
  });
}

for (const code of ["EACCES", "ELOOP", "ENOTDIR", "EIO"]) {
  test(`lstat ${code} is hard failure, never a path_not_exists success`, async (t) => {
    const f = await fixture(t);
    const registry = await createLocalCheckRegistry(f.config);
    const original = fs.lstat;
    const lstat = t.mock.method(fs, "lstat", (...args: Parameters<typeof fs.lstat>) => {
      if (args[0] === join(f.repo, "absent")) return Promise.reject(Object.assign(new Error("private path and detail"), { code }));
      return original(...args);
    });
    try { hardFailure(await registry.run([definition("path_not_exists", { subject: "missing" }, "WARN")])); }
    finally { lstat.mock.restore(); }
  });
}

test("ENOTDIR from a real intermediate regular file is not absence", async (t) => {
  const f = await fixture(t);
  f.config.targets.impossible = { root: "area", relativePath: "repository/seed.txt/child" };
  const registry = await createLocalCheckRegistry(f.config);
  hardFailure(await probe(f, registry, "path_not_exists", { subject: "impossible" }, "WARN"));
});

test("canonical root symlinks, non-directory roots and unsupported target types fail closed", async (t) => {
  const f = await fixture(t);
  await fs.symlink(f.repo, join(f.base, "root-link"));
  await fs.mkdir(join(f.repo, "subdirectory"));
  for (const root of [join(f.base, "root-link"), join(f.base, "root-link/subdirectory"), join(f.repo, "seed.txt"), `${f.base}/root-link/..`]) {
    if (root.endsWith("/..")) { await rejects(createLocalCheckRegistry({ ...f.config, roots: { area: root } }), LocalCheckError); continue; }
    const registry = await createLocalCheckRegistry({ ...f.config, roots: { area: root } });
    hardFailure(await probe(f, registry, "path_not_exists", { subject: "missing" }, "WARN"));
  }
  const original = fs.lstat;
  const lstat = t.mock.method(fs, "lstat", (...args: Parameters<typeof fs.lstat>) => {
    if (args[0] === join(f.repo, "seed.txt")) return Promise.resolve({ isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false });
    return original(...args);
  });
  try { hardFailure(await (await createLocalCheckRegistry(f.config)).run([definition("path_not_exists", { subject: "seed" }, "WARN")])); }
  finally { lstat.mock.restore(); }
});

for (const mode of ["parent-discovery", "git-file", "git-symlink", "repo-symlink", "bare"] as const) {
  test(`repository ${mode} namespace is refused before a Git spawn`, async (t) => {
    const f = await fixture(t);
    const directory = join(f.repo, "nested");
    if (mode === "repo-symlink") await fs.symlink(f.repo, directory);
    else {
      await fs.mkdir(directory);
      if (mode === "git-file") await fs.writeFile(join(directory, ".git"), `gitdir: ${join(f.repo, ".git")}\n`);
      if (mode === "git-symlink") await fs.symlink(join(f.repo, ".git"), join(directory, ".git"));
      if (mode === "bare") await setupGit(directory, ["init", "--bare"]);
    }
    f.config.repositories.sample!.relativePath = "repository/nested";
    const registry = await createLocalCheckRegistry(f.config);
    let spawns = 0;
    const exec = t.mock.method(childProcess, "execFile", () => { spawns += 1; throw new Error("unexpected parent discovery"); });
    try { hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN")); strictEqual(spawns, 0); }
    finally { exec.mock.restore(); }
  });
}

test("fixed Git cwd/argv/limits and minimal environment defeat inherited redirection, trace and config poisoning", async (t) => {
  const f = await fixture(t);
  const other = join(f.base, "other");
  await fs.mkdir(other);
  await setupGit(other, ["init", "-b", "other"]);
  const poison: Record<string, string> = {
    GIT_DIR: join(other, ".git"), GIT_WORK_TREE: other, GIT_INDEX_FILE: join(f.base, "wrong-index"),
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "private-command",
    GIT_CONFIG_PARAMETERS: "private override", GIT_CONFIG_GLOBAL: join(f.base, "private-global"), GIT_CONFIG_SYSTEM: join(f.base, "private-system"),
    GIT_TRACE: join(f.base, "trace"), GIT_TRACE2_EVENT: join(f.base, "trace2"), GIT_SSH_COMMAND: "private helper",
    GIT_CONFIG: join(f.base, "private-config"), GIT_COMMON_DIR: join(other, ".git"), GIT_OBJECT_DIRECTORY: join(other, ".git/objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(other, ".git/objects"), GIT_EXEC_PATH: other, GIT_ATTR_SOURCE: "private", HOME: other, XDG_CONFIG_HOME: other,
  };
  const saved = Object.fromEntries(Object.keys(poison).map((key) => [key, process.env[key]]));
  const original = childProcess.execFile;
  const calls: { args: readonly string[]; options: ExecFileOptions }[] = [];
  const exec = t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
    strictEqual(args[0], GIT);
    calls.push({ args: args[1] as string[], options: args[2] as ExecFileOptions });
    return Reflect.apply(original, childProcess, args);
  });
  try {
    Object.assign(process.env, poison);
    const registry = await createLocalCheckRegistry(f.config);
    verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected: f.head }), true);
    verdict(await probe(f, registry, "branch_exists", { repo: "sample", subject: "primary" }), true);
    verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
    for (const { args, options } of calls) {
      strictEqual(options.cwd, f.repo); strictEqual(options.shell, false);
      strictEqual(options.timeout, GIT_TIMEOUT_MS); strictEqual(options.maxBuffer, GIT_MAX_BUFFER);
      strictEqual(options.killSignal, "SIGKILL"); strictEqual(options.signal instanceof AbortSignal, true);
      strictEqual(args.includes(`--git-dir=${join(f.repo, ".git")}`), true);
      strictEqual(args.includes(`--work-tree=${f.repo}`), !args.includes("--show-toplevel"));
      strictEqual(args.includes("--no-optional-locks"), true);
      strictEqual(options.env?.GIT_OPTIONAL_LOCKS, "0");
      strictEqual(options.env?.GIT_CONFIG_GLOBAL, "/dev/null");
      for (const key of Object.keys(poison).filter((key) => key !== "GIT_CONFIG_GLOBAL" && key !== "GIT_CONFIG_SYSTEM")) strictEqual(Object.hasOwn(options.env!, key), false);
    }
    strictEqual(calls.length > 0, true);
    t.diagnostic(JSON.stringify({ gitCalls: calls.length, inheritedOverridesForwarded: 0, traceMarkers: 0, locksCreated: 0, readonly: true }));
  } finally {
    exec.mock.restore();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  for (const [key, value] of Object.entries(saved)) strictEqual(process.env[key], value);
});

test("repository fsmonitor and hook marker commands never execute and status never writes the index", async (t) => {
  const f = await fixture(t);
  const marker = join(f.base, "helper-marker");
  const monitor = join(f.base, "monitor.sh");
  await fs.writeFile(monitor, `#!/bin/sh\nprintf executed > '${marker}'\n`, { mode: 0o755 });
  const hooks = join(f.base, "hooks"); await fs.mkdir(hooks);
  for (const hook of ["post-index-change", "post-checkout", "pre-commit"]) await fs.writeFile(join(hooks, hook), `#!/bin/sh\nprintf executed > '${marker}'\n`, { mode: 0o755 });
  await setupGit(f.repo, ["config", "core.fsmonitor", monitor]);
  await setupGit(f.repo, ["config", "core.hooksPath", hooks]);
  await setupGit(f.repo, ["config", "core.untrackedCache", "true"]);
  const registry = await createLocalCheckRegistry(f.config);
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
  await rejects(fs.lstat(marker), { code: "ENOENT" });
  t.diagnostic(JSON.stringify({ fsmonitorExecutions: 0, hookExecutions: 0, indexHashStable: true }));
});

for (const key of ["filter.marker.clean", "filter.marker.process", "filter.marker.smudge", "diff.marker.textconv", "diff.external", "diff.marker.command"] as const) {
  test(`status refuses external ${key} config without running the marker`, async (t) => {
    const f = await fixture(t);
    const marker = join(f.base, "filter-marker");
    const helper = join(f.base, "filter.sh");
    await fs.writeFile(helper, `#!/bin/sh\nprintf executed > '${marker}'\n`, { mode: 0o755 });
    await fs.writeFile(join(f.repo, ".gitattributes"), "seed.txt filter=marker diff=marker\n");
    await fs.writeFile(join(f.repo, "seed.txt"), "synthetic filter candidate dirt\n");
    await setupGit(f.repo, ["config", key, helper]);
    const registry = await createLocalCheckRegistry(f.config);
    hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN"));
    await rejects(fs.lstat(marker), { code: "ENOENT" });
    t.diagnostic(JSON.stringify({ externalFilterMarkerExecutions: 0, configRefusal: true }));
  });
}

test("effective included filter config and submodules are unsupported, not silently clean", async (t) => {
  const f = await fixture(t);
  const included = join(f.repo, ".git/included.conf");
  await fs.writeFile(included, "[filter \"marker\"]\nclean = private-command\n");
  await setupGit(f.repo, ["config", "include.path", included]);
  const registry = await createLocalCheckRegistry(f.config);
  hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN"));
  await setupGit(f.repo, ["config", "--unset", "include.path"]);
  await setupGit(f.repo, ["update-index", "--add", "--cacheinfo", `160000,${f.head},module`]);
  hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN"));
  await setupGit(f.repo, ["update-index", "--force-remove", "module"]);
  await setupGit(f.repo, ["config", "submodule.marker.path", "module"]);
  hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN"));
});

type Callback = (error: Error | null, stdout: Buffer, stderr: Buffer) => void;
function simulatedGit(t: TestContext, f: Fixture, responder: (args: string[], callback: Callback, options: ExecFileOptions) => void) {
  return t.mock.method(childProcess, "execFile", (...values: unknown[]) => {
    const args = values[1] as string[];
    const callback = values[3] as Callback;
    const options = values[2] as ExecFileOptions;
    if (args.includes("--show-toplevel")) queueMicrotask(() => callback(null, Buffer.from(`${f.repo}\nfalse\ntrue\n`), Buffer.alloc(0)));
    else responder(args, callback, options);
    return {} as ChildProcess;
  });
}

for (const mode of ["command-error", "stderr", "malformed-sha", "oversized", "malformed-ref", "malformed-config", "malformed-mode", "malformed-status", "top-level-mismatch"] as const) {
  test(`Git ${mode} is a private hard handler failure even with WARN`, async (t) => {
    const f = await fixture(t);
    const registry = await createLocalCheckRegistry(f.config);
    const original = childProcess.execFile;
    const commands: string[][] = [];
    const exec = t.mock.method(childProcess, "execFile", (...values: unknown[]) => {
      const args = values[1] as string[];
      commands.push(args);
      const callback = values[3] as Callback;
      let output: Buffer;
      let error: Error | null = null;
      let stderr = Buffer.alloc(0);
      if (mode === "top-level-mismatch") output = Buffer.from("private outside path\nfalse\ntrue\n");
      else if (args.includes("--show-toplevel")) output = Buffer.from(`${f.repo}\nfalse\ntrue\n`);
      else if (mode === "command-error") { output = Buffer.alloc(0); error = new Error("private stderr and path"); }
      else if (mode === "stderr") { output = Buffer.from(`${f.head}\n`); stderr = Buffer.from("private stderr"); }
      else if (mode === "oversized") output = Buffer.alloc(GIT_MAX_BUFFER + 1);
      else if (mode === "malformed-sha") output = Buffer.from("not a sha\n");
      else if (mode === "malformed-ref") output = Buffer.from("refs/tags/private\n");
      else if (mode === "malformed-config") output = Buffer.from("malformed no terminator");
      else if (args.includes("config")) output = Buffer.from("core.bare\0");
      else if (mode === "malformed-mode") output = Buffer.from("unknown\0");
      else if (args.includes("--format=%(objectmode)")) output = Buffer.from("100644\0");
      else if (args.includes("ls-files") && args.includes("-v")) output = Buffer.from("H private-entry\0");
      else output = Buffer.from("invalid status\0");
      queueMicrotask(() => callback(error, output, stderr));
      return {} as ChildProcess;
    });
    try {
      const type = mode === "malformed-ref" ? "branch_exists" : ["malformed-config", "malformed-mode", "malformed-status"].includes(mode) ? "worktree_clean" : "sha_matches";
      const params = type === "branch_exists" ? { repo: "sample", subject: "primary" } : type === "worktree_clean" ? { repo: "sample" } : { repo: "sample", expected: f.head };
      const report = await readOnly(f, () => registry.run([definition(type, params, "WARN"), definition("path_exists", { subject: "seed" }, "STOP", "later")]));
      hardFailure(report); strictEqual(report.results[1]?.status, "skipped");
      if (mode === "malformed-status") strictEqual(commands.some((args) => args.includes("status")), true, "malformed status still reaches the status command after index checks");
      const serialized = JSON.stringify(report);
      for (const value of [f.base, f.repo, f.head, "refs/heads/primary", "private", "stderr"]) strictEqual(serialized.includes(value), false);
    } finally { exec.mock.restore(); strictEqual(childProcess.execFile, original); }
  });
}

test("Git transport synchronous throws are replaced by value-free failures", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  const exec = t.mock.method(childProcess, "execFile", () => { throw new Error(f.repo + " private stderr"); });
  try { hardFailure(await probe(f, registry, "sha_matches", { repo: "sample", expected: f.head }, "WARN")); }
  finally { exec.mock.restore(); }
});

test("runner aborts a pending child, consumes late private rejection and reports timeout without cached success", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  let aborted = 0;
  let started = 0;
  let unhandled = 0;
  const onUnhandled = (): void => { unhandled += 1; };
  process.on("unhandledRejection", onUnhandled);
  const exec = simulatedGit(t, f, (_args, callback, options) => {
    started += 1;
    options.signal!.addEventListener("abort", () => { aborted += 1; setTimeout(() => callback(new Error("private late error"), Buffer.alloc(0), Buffer.from("private stderr")), 10); }, { once: true });
  });
  try {
    const report = await readOnly(f, async () => {
      const value = await registry.run([definition("sha_matches", { repo: "sample", expected: f.head }, "WARN")], {}, { timeoutMs: 50 });
      await delay(40);
      return value;
    });
    strictEqual(report.results[0]?.reason, "timeout"); strictEqual(report.results[0]?.status, "failed");
    deepStrictEqual([started, aborted, unhandled], [1, 1, 0]);
    t.diagnostic(JSON.stringify({ pendingChild: started, abortSignals: aborted, lateCallbackRejections: 1, unhandledRejections: unhandled }));
  } finally { exec.mock.restore(); process.removeListener("unhandledRejection", onUnhandled); }
  verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected: f.head }), true);
});

test("timeout during a filesystem wait prevents subsequent component reads and Git spawning", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  const stats = await fs.lstat(f.base);
  let reads = 0;
  let spawns = 0;
  const lstat = t.mock.method(fs, "lstat", async () => { reads += 1; await delay(40); return stats; });
  const exec = t.mock.method(childProcess, "execFile", () => { spawns += 1; throw new Error("late spawn forbidden"); });
  try {
    const report = await registry.run([definition("worktree_clean", { repo: "sample" }, "WARN")], {}, { timeoutMs: 5 });
    strictEqual(report.results[0]?.reason, "timeout");
    await delay(60);
    deepStrictEqual([reads, spawns], [1, 0]);
  } finally { lstat.mock.restore(); exec.mock.restore(); }
});

test("bounded child timeout errors fail hard and never turn branch_not_exists into a passing predicate", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  const exec = simulatedGit(t, f, (_args, callback, options) => {
    strictEqual(options.timeout, GIT_TIMEOUT_MS);
    queueMicrotask(() => callback(Object.assign(new Error("private timeout"), { killed: true, signal: "SIGKILL" }), Buffer.alloc(0), Buffer.alloc(0)));
  });
  try { hardFailure(await probe(f, registry, "branch_not_exists", { repo: "sample", subject: "absent" }, "WARN")); }
  finally { exec.mock.restore(); }
});

test("local reports stay closed and predicate-only; factory does not overwrite base pure bindings", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  const report = await probe(f, registry, "worktree_clean", { repo: "sample" });
  deepStrictEqual(Object.keys(report).sort(), ["authorization", "results", "satisfied", "verification"]);
  deepStrictEqual(Object.keys(report.results[0]!).sort(), ["check_id", "reason", "status", "type"]);
  strictEqual(Object.getPrototypeOf(report), null); strictEqual(Object.isFrozen(report), true);
  strictEqual(Object.isFrozen(report.results), true); strictEqual(Object.isFrozen(report.results[0]), true);
  strictEqual(Object.getPrototypeOf(report.results[0]), null);
  const pure = new CheckRegistry(); pure.registerBindingPredicates();
  verdict(await pure.run([definition("sha_matches", { expected: f.head, actual: f.head })]), true);
  hardFailure(await registry.run([definition("sha_matches", { expected: f.head, actual: f.head }, "WARN")]));
  await rejects(async () => registry.registerBindingPredicates(), (error: unknown) => error instanceof CheckError && error.code === "duplicate-registration");
  strictEqual((await registry.run([definition("env_matches", { expected: "sample", actual: "sample" })])).results[0]?.reason, "missing-handler");
  match(JSON.stringify(report), /"verification":"predicate-only","authorization":"none"/u);
});

for (const setting of ["core.bare", "core.worktree"]) {
  test(`Git namespace validation rejects ${setting} instead of masking it with an explicit worktree`, async (t) => {
    const f = await fixture(t);
    const outside = join(f.base, "other"); await fs.mkdir(outside);
    await setupGit(f.repo, ["config", setting, setting === "core.bare" ? "true" : outside]);
    const registry = await createLocalCheckRegistry(f.config);
    hardFailure(await probe(f, registry, "branch_not_exists", { repo: "sample", subject: "absent" }, "WARN"));
  });
}

for (const mode of ["runner-abort", "child-timeout"] as const) {
  test(`native child ${mode} kills a pending synthetic executable without fixture writes or unhandled rejections`, async (t) => {
    const f = await fixture(t);
    const executable = join(f.base, "slow-git");
    // Trusted-host test binary only; no shell is supplied to the probe API.
    await fs.writeFile(executable, "#!/bin/sh\nexec /bin/sleep 10\n", { mode: 0o755 });
    f.config.gitExecutable = executable;
    const registry = await createLocalCheckRegistry(f.config);
    const original = childProcess.execFile;
    let exitSignal: NodeJS.Signals | null = null;
    let killed = false;
    let spawned = 0;
    const exec = t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
      const child = Reflect.apply(original, childProcess, args) as ChildProcess;
      spawned += 1;
      child.once("exit", (_code, signal) => { exitSignal = signal; killed = child.killed; });
      return child;
    });
    let unhandled = 0;
    const onUnhandled = (): void => { unhandled += 1; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const report = await readOnly(f, async () => {
        const result = await registry.run([definition("worktree_clean", { repo: "sample" }, "WARN")], {}, { timeoutMs: mode === "runner-abort" ? 100 : 5_000 });
        await delay(100);
        return result;
      });
      strictEqual(report.results[0]?.reason, mode === "runner-abort" ? "timeout" : "handler-threw");
      strictEqual(report.results[0]?.status, "failed");
      deepStrictEqual([spawned, killed, exitSignal, unhandled], [1, true, mode === "runner-abort" ? "SIGTERM" : "SIGKILL", 0]);
      t.diagnostic(JSON.stringify({ nativeChildCase: mode, spawned, killed, exitSignal, unhandledRejections: unhandled, writes: 0 }));
    } finally { exec.mock.restore(); process.removeListener("unhandledRejection", onUnhandled); }
  });
}

test("actual SHA-256 repository HEAD is supported without treating a claimed SHA as source authority", async (t) => {
  const f = await fixture(t);
  const repo = join(f.base, "sha256"); await fs.mkdir(repo);
  await setupGit(repo, ["init", "--object-format=sha256", "-b", "primary"]);
  await setupGit(repo, ["config", "user.name", "Synthetic Fixture"]);
  await setupGit(repo, ["config", "user.email", "fixture@example.invalid"]);
  await fs.writeFile(join(repo, "seed.txt"), "synthetic SHA-256 seed\n");
  await setupGit(repo, ["add", "--", "seed.txt"]);
  await setupGit(repo, ["commit", "-m", "synthetic SHA-256 fixture"]);
  f.config.repositories.sample!.relativePath = "sha256";
  const registry = await createLocalCheckRegistry(f.config);
  const head = await setupGit(repo, ["rev-parse", "HEAD"]);
  strictEqual(head.length, 64);
  verdict(await probe(f, registry, "sha_matches", { repo: "sample", expected: head }), true);
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
});

test("null-prototype, frozen and non-enumerable own config data are accepted without mutating sources", async (t) => {
  const f = await fixture(t);
  const target = Object.freeze(Object.assign(Object.create(null), { root: "area", relativePath: "repository/seed.txt" }));
  const targets = Object.create(null) as Record<string, typeof target>;
  Object.defineProperty(targets, "seed", { value: target }); Object.freeze(targets);
  const roots = Object.freeze(Object.assign(Object.create(null), { area: f.base }));
  const config = Object.create(null) as LocalCheckConfig;
  for (const [key, value] of Object.entries({ ...f.config, roots, targets })) Object.defineProperty(config, key, { value });
  Object.freeze(config);
  const registry = await createLocalCheckRegistry(config);
  verdict(await probe(f, registry, "path_exists", { subject: "seed" }), true);
});

for (const state of ["assume-unchanged", "skip-worktree", "both"] as const) {
  test(`worktree_clean refuses actual ${state} index flags even when Git status hides changed tracked content`, async (t) => {
    const f = await fixture(t);
    if (state !== "skip-worktree") await setupGit(f.repo, ["update-index", "--assume-unchanged", "--", "seed.txt"]);
    if (state !== "assume-unchanged") await setupGit(f.repo, ["update-index", "--skip-worktree", "--", "seed.txt"]);
    const flagsBefore = await setupGit(f.repo, ["ls-files", "-v", "-z"]);
    strictEqual(flagsBefore[0], state === "assume-unchanged" ? "h" : state === "skip-worktree" ? "S" : "s");
    await fs.writeFile(join(f.repo, "seed.txt"), "synthetic hidden tracked change\n");
    const contentHash = digest(await fs.readFile(join(f.repo, "seed.txt")));
    strictEqual(contentHash === digest("synthetic seed\n"), false);
    strictEqual(await setupGit(f.repo, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]), "");
    const indexBefore = digest(await fs.readFile(join(f.repo, ".git/index")));
    const gitBefore = await inventory(join(f.repo, ".git"));
    const wholeBefore = await inventory(f.base);
    const registry = await createLocalCheckRegistry(f.config);
    let callbacks = 0;
    registry.register("custom:host/after-flags", () => { callbacks += 1; return true; });
    const original = childProcess.execFile;
    const commands: string[][] = [];
    const exec = t.mock.method(childProcess, "execFile", (...args: unknown[]) => {
      commands.push(args[1] as string[]);
      return Reflect.apply(original, childProcess, args);
    });
    try {
      for (const onFail of ["STOP", "WARN"] as const) {
        const report = await readOnly(f, () => registry.run([
          definition("worktree_clean", { repo: "sample" }, onFail),
          definition("custom:host/after-flags", {}, "STOP", "after-flags"),
        ], {}, { timeoutMs: 2_000 }));
        hardFailure(report);
        strictEqual(report.verification, "predicate-only"); strictEqual(report.authorization, "none");
        strictEqual(report.results[1]?.status, "skipped"); strictEqual(report.results[1]?.reason, "stopped");
        strictEqual(callbacks, 0);
        strictEqual(JSON.stringify(report).includes(f.repo), false);
        t.diagnostic(JSON.stringify({ indexFlagState: state, onFail, trackedContentChanged: true, gitStatusEmpty: true,
          probeSatisfied: report.satisfied, status: report.results[0]?.status, reason: report.results[0]?.reason,
          laterCallbacks: callbacks, indexSha256: indexBefore, indexSha256After: digest(await fs.readFile(join(f.repo, ".git/index"))),
          fullGitHash: gitBefore, fullGitHashAfter: await inventory(join(f.repo, ".git")),
          fullFixtureHash: wholeBefore, fullFixtureHashAfter: await inventory(f.base),
          workingFileSha256: contentHash, workingFileSha256After: digest(await fs.readFile(join(f.repo, "seed.txt"))), readonly: true, markers: 0 }));
      }
      strictEqual(commands.filter((args) => args.includes("ls-files") && args.includes("-v") && args.includes("-z")).length, 2);
      strictEqual(commands.some((args) => args.includes("status") || args.includes("update-index") || args.includes("--refresh")), false);
    } finally { exec.mock.restore(); }
    strictEqual(await setupGit(f.repo, ["ls-files", "-v", "-z"]), flagsBefore, "probe must not clear flags");
    strictEqual(digest(await fs.readFile(join(f.repo, ".git/index"))), indexBefore);
    strictEqual(digest(await fs.readFile(join(f.repo, "seed.txt"))), contentHash);
    strictEqual(await inventory(join(f.repo, ".git")), gitBefore);
    strictEqual(await inventory(f.base), wholeBefore);
  });
}

test("clearedFlags restore ordinary clean/dirty predicates without cache or probe index repair", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  await setupGit(f.repo, ["update-index", "--assume-unchanged", "--", "seed.txt"]);
  await setupGit(f.repo, ["update-index", "--skip-worktree", "--", "seed.txt"]);
  hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN"));
  // Only fixture setup clears flags; the probe contains no update-index operation.
  await setupGit(f.repo, ["update-index", "--no-assume-unchanged", "--", "seed.txt"]);
  await setupGit(f.repo, ["update-index", "--no-skip-worktree", "--", "seed.txt"]);
  strictEqual((await setupGit(f.repo, ["ls-files", "-v", "-z"]))[0], "H");
  const indexBefore = digest(await fs.readFile(join(f.repo, ".git/index")));
  const gitBefore = await inventory(join(f.repo, ".git"));
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
  await fs.writeFile(join(f.repo, "seed.txt"), "synthetic ordinary dirty change\n");
  let callbacks = 0;
  registry.register("custom:host/after-cleared", () => { callbacks += 1; return true; });
  const dirty = await readOnly(f, () => registry.run([
    definition("worktree_clean", { repo: "sample" }, "WARN"),
    definition("custom:host/after-cleared", {}, "STOP", "after-cleared"),
  ], {}, { timeoutMs: 2_000 }));
  verdict(dirty, false); strictEqual(dirty.results[0]?.status, "warning");
  strictEqual(dirty.results[1]?.status, "passed"); strictEqual(callbacks, 1);
  await fs.writeFile(join(f.repo, "seed.txt"), "synthetic seed\n");
  verdict(await probe(f, registry, "worktree_clean", { repo: "sample" }), true);
  strictEqual(digest(await fs.readFile(join(f.repo, ".git/index"))), indexBefore);
  strictEqual(await inventory(join(f.repo, ".git")), gitBefore);
  t.diagnostic(JSON.stringify({ indexFlagState: "clearedFlags", cleanSatisfied: true, dirtySatisfied: false,
    dirtyReason: dirty.results[0]?.reason, dirtyStatus: dirty.results[0]?.status, laterCallbacks: callbacks,
    indexSha256: indexBefore, indexSha256After: digest(await fs.readFile(join(f.repo, ".git/index"))),
    fullGitHash: gitBefore, fullGitHashAfter: await inventory(join(f.repo, ".git")), readonly: true, markers: 0 }));
});

test("sparse-checkout skip-worktree entries are unsupported without index or working-tree changes", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(join(f.repo, "keep")); await fs.mkdir(join(f.repo, "omit"));
  await fs.writeFile(join(f.repo, "keep/visible.txt"), "synthetic visible\n");
  await fs.writeFile(join(f.repo, "omit/hidden.txt"), "synthetic hidden\n");
  await setupGit(f.repo, ["add", "--", "keep", "omit"]);
  await setupGit(f.repo, ["commit", "-m", "synthetic sparse fixture"]);
  await setupGit(f.repo, ["sparse-checkout", "init", "--cone"]);
  await setupGit(f.repo, ["sparse-checkout", "set", "keep"]);
  const entries = await setupGit(f.repo, ["ls-files", "-v", "-z"]);
  strictEqual(entries.split("\0").some((record) => record.startsWith("S ")), true);
  strictEqual(await setupGit(f.repo, ["--no-optional-locks", "status", "--porcelain=v1", "-z"]), "");
  const indexBefore = digest(await fs.readFile(join(f.repo, ".git/index")));
  const gitBefore = await inventory(join(f.repo, ".git"));
  const wholeBefore = await inventory(f.base);
  const registry = await createLocalCheckRegistry(f.config);
  hardFailure(await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN"));
  strictEqual(await setupGit(f.repo, ["ls-files", "-v", "-z"]), entries);
  strictEqual(await inventory(f.base), wholeBefore);
  t.diagnostic(JSON.stringify({ indexFlagState: "sparse-skip-worktree", gitStatusEmpty: true, probeSatisfied: false,
    indexSha256: indexBefore, indexSha256After: digest(await fs.readFile(join(f.repo, ".git/index"))),
    fullGitHash: gitBefore, fullGitHashAfter: await inventory(join(f.repo, ".git")),
    fullFixtureHash: wholeBefore, fullFixtureHashAfter: await inventory(f.base), readonly: true, markers: 0 }));
});

test("ordinary unmerged M index entries stay normal dirty predicates rather than unsupported flags", async (t) => {
  const f = await fixture(t);
  const blob = await setupGit(f.repo, ["rev-parse", "HEAD:seed.txt"]);
  await new Promise<void>((resolve, reject) => {
    const child = childProcess.execFile(GIT, ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "update-index", "--index-info"],
      { cwd: f.repo, env: { ...SETUP_ENV }, shell: false, timeout: 5_000, maxBuffer: GIT_MAX_BUFFER },
      (error) => error === null ? resolve() : reject(error));
    child.stdin!.end(`0 ${"0".repeat(blob.length)}\tseed.txt\n` + [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\tseed.txt\n`).join(""));
  });
  strictEqual((await setupGit(f.repo, ["ls-files", "-v", "-z"]))[0], "M");
  const registry = await createLocalCheckRegistry(f.config);
  const report = await probe(f, registry, "worktree_clean", { repo: "sample" }, "WARN");
  verdict(report, false); strictEqual(report.results[0]?.status, "warning");
});

test("index flag parsing treats private path bytes as opaque, including invalid UTF-8 and newlines", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  let indexReads = 0;
  let statusReads = 0;
  const exec = simulatedGit(t, f, (args, callback) => {
    let output: Buffer;
    if (args.includes("config")) output = Buffer.from("core.bare\0");
    else if (args.includes("--format=%(objectmode)")) output = Buffer.from("100644\0");
    else if (args.includes("ls-files") && args.includes("-v")) {
      indexReads += 1;
      output = Buffer.concat([Buffer.from("H private-entry-"), Buffer.from([0xff, 0xfe, 10]), Buffer.from("suffix\0")]);
    } else if (args.includes("status")) { statusReads += 1; output = Buffer.alloc(0); }
    else throw new Error("unexpected fixed command");
    queueMicrotask(() => callback(null, output, Buffer.alloc(0)));
  });
  try {
    const report = await probe(f, registry, "worktree_clean", { repo: "sample" });
    verdict(report, true); strictEqual(JSON.stringify(report).includes("private-entry"), false);
    deepStrictEqual([indexReads, statusReads], [1, 1]);
  } finally { exec.mock.restore(); }
});

test("malformed, unknown, special or oversized index-flag output fails hard before status even with WARN", async (t) => {
  const f = await fixture(t);
  const registry = await createLocalCheckRegistry(f.config);
  let callbacks = 0;
  registry.register("custom:host/after-index", () => { callbacks += 1; return true; });
  const cases: [string, Buffer][] = [
    ["assume-tag", Buffer.from("h private-entry\0")],
    ["skip-tag", Buffer.from("S private-entry\0")],
    ["both-tag", Buffer.from("s private-entry\0")],
    ["assume-unmerged-tag", Buffer.from("m private-entry\0")],
    ["unknown-tag", Buffer.from("Z private-entry\0")],
    ["non-ascii-tag", Buffer.from([0xff, 32, 120, 0])],
    ["wrong-separator", Buffer.from("H\tprivate-entry\0")],
    ["empty-path", Buffer.from("H \0")],
    ["missing-terminator", Buffer.from("H private-entry")],
    ["empty-record", Buffer.from("\0")],
    ["malformed-tail", Buffer.from("H private-entry\0tail")],
    ["oversized", Buffer.alloc(GIT_MAX_BUFFER + 1)],
  ];
  for (const [name, entries] of cases) {
    let indexReads = 0;
    let statusReads = 0;
    const exec = simulatedGit(t, f, (args, callback) => {
      let output: Buffer;
      if (args.includes("config")) output = Buffer.from("core.bare\0");
      else if (args.includes("--format=%(objectmode)")) output = Buffer.from("100644\0");
      else if (args.includes("ls-files") && args.includes("-v")) { indexReads += 1; output = entries; }
      else if (args.includes("status")) { statusReads += 1; output = Buffer.alloc(0); }
      else throw new Error("unexpected fixed command");
      queueMicrotask(() => callback(null, output, Buffer.alloc(0)));
    });
    try {
      for (const onFail of ["STOP", "WARN"] as const) {
        const report = await readOnly(f, () => registry.run([
          definition("worktree_clean", { repo: "sample" }, onFail),
          definition("custom:host/after-index", {}, "STOP", "after-index"),
        ], {}, { timeoutMs: 2_000 }));
        hardFailure(report); strictEqual(report.results[1]?.reason, "stopped");
        strictEqual(JSON.stringify(report).includes("private-entry"), false);
      }
      deepStrictEqual([indexReads, statusReads, callbacks], [2, 0, 0]);
    } finally { exec.mock.restore(); }
    t.diagnostic(JSON.stringify({ indexFlagOutputCase: name, hardFailure: true, statusReads, laterCallbacks: callbacks, readonly: true }));
  }
});
