import childProcess from "node:child_process";
import { join } from "node:path";
import { fail, fullBranchRef, GIT_MAX_BUFFER, GIT_TIMEOUT_MS, LocalCheckError, type ConfigSnapshot } from "./config.js";
import { active } from "./filesystem.js";

// An allowlist, not a filtered copy of the host environment. No inherited Git/config/trace
// state, credentials, auth helpers, dynamic PATH, HOME or network settings.
const ENV = Object.freeze({
  PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1",
});
const SETTINGS = Object.freeze([
  "--no-pager", "--no-optional-locks", "--literal-pathspecs",
  "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
  "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null",
  "-c", "core.preloadIndex=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false",
  "-c", "status.submoduleSummary=false",
]);

/** Only this module's fixed commands and a host-configured full ref reach argv. */
function git(config: ConfigSnapshot, repo: string, command: readonly string[], signal: AbortSignal, bindWorktree = true): Promise<Buffer> {
  active(signal);
  return new Promise((resolve, reject) => {
    const failure = (): void => { reject(new LocalCheckError("probe-failed")); };
    try {
      childProcess.execFile(config.gitExecutable, [
        ...SETTINGS, `--git-dir=${join(repo, ".git")}`, ...(bindWorktree ? [`--work-tree=${repo}`] : []), ...command,
      ], {
        cwd: repo, shell: false, windowsHide: true, env: { ...ENV }, encoding: "buffer",
        timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, killSignal: "SIGKILL", signal,
      }, (error, stdout, stderr) => {
        if (error !== null || signal.aborted || !Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr) ||
          stdout.length > GIT_MAX_BUFFER || stderr.length !== 0) failure();
        else resolve(stdout);
      });
    } catch {
      failure();
    }
  });
}

function ascii(buffer: Buffer): string {
  // Protocol-like command output must not be silently repaired by UTF-8 decoding.
  if (buffer.some((byte) => byte > 127)) fail();
  return buffer.toString("ascii");
}

export async function validateRepository(config: ConfigSnapshot, repo: string, signal: AbortSignal): Promise<void> {
  // Do not mask core.bare/core.worktree with --work-tree during namespace validation.
  const output = await git(config, repo, ["rev-parse", "--show-toplevel", "--is-bare-repository", "--is-inside-work-tree"], signal, false);
  if (!output.equals(Buffer.from(`${repo}\nfalse\ntrue\n`))) fail();
}

export async function headMatches(config: ConfigSnapshot, repo: string, expected: string, signal: AbortSignal): Promise<boolean> {
  const output = ascii(await git(config, repo, ["rev-parse", "--verify", "HEAD^{commit}"], signal));
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})\n$/u.test(output)) fail();
  return output.slice(0, -1) === expected.toLowerCase();
}

export async function branchExists(config: ConfigSnapshot, repo: string, ref: string, signal: AbortSignal): Promise<boolean> {
  const output = ascii(await git(config, repo, ["for-each-ref", "--format=%(refname)", ref], signal));
  if (output === "") return false;
  if (!output.endsWith("\n")) fail();
  const refs = output.slice(0, -1).split("\n");
  if (!refs.every((value) => fullBranchRef(value) && (value === ref || value.startsWith(`${ref}/`))) ||
    new Set(refs).size !== refs.length) fail();
  // for-each-ref also accepts prefix matches: only the full configured ref counts.
  return refs.includes(ref);
}

async function supportedStatus(config: ConfigSnapshot, repo: string, signal: AbortSignal): Promise<void> {
  // Discover names only (including effective local includes); never expose values.
  // Reading status can invoke clean/process filters, despite being a read command.
  const configOutput = ascii(await git(config, repo, ["config", "--includes", "--null", "--name-only", "--list"], signal));
  if (configOutput !== "" && !configOutput.endsWith("\0")) fail();
  const keys = configOutput === "" ? [] : configOutput.slice(0, -1).split("\0");
  for (const key of keys) {
    if (!/^[a-z0-9][a-z0-9._/-]*$/iu.test(key) ||
      /^(?:filter\.|submodule\.|diff\.external$|diff\..*\.(?:textconv|command)$)/iu.test(key)) fail();
  }
  // Modes only, not file bodies or paths. Gitlinks mean unsupported submodules.
  const modes = ascii(await git(config, repo, ["ls-files", "--format=%(objectmode)", "-z"], signal));
  if (modes !== "" && (!modes.endsWith("\0") ||
    !modes.slice(0, -1).split("\0").every((mode) => /^(?:100644|100755|120000)$/u.test(mode)))) fail();
  // -v emits lowercase tags for assume-unchanged, S/s for skip-worktree (also
  // sparse entries). Only ordinary cached H and unmerged M entries are supported.
  // Paths remain opaque bytes: inspect only the tag/space and NUL framing.
  const entries = await git(config, repo, ["ls-files", "-v", "-z"], signal);
  let start = 0;
  while (start < entries.length) {
    const end = entries.indexOf(0, start);
    if (end < start + 3 || entries[start + 1] !== 32 ||
      (entries[start] !== 72 && entries[start] !== 77)) fail();
    start = end + 1;
  }
}

export async function worktreeClean(config: ConfigSnapshot, repo: string, signal: AbortSignal): Promise<boolean> {
  await supportedStatus(config, repo, signal);
  const output = await git(config, repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none", "--no-renames"], signal);
  if (output.length === 0) return true;
  if (output[output.length - 1] !== 0) fail();
  // Path bytes stay private and opaque. With renames disabled, each record is XY
  // plus one nonempty path; malformed output is infrastructure failure, not dirt.
  let start = 0;
  for (let end = 0; end < output.length; end += 1) {
    if (output[end] !== 0) continue;
    const record = output.subarray(start, end);
    const status = record.subarray(0, 2).toString("ascii");
    if (record.length < 4 || record[2] !== 32 || record[0]! > 127 || record[1]! > 127 ||
      !(status === "??" || /^(?:DD|AU|UD|UA|DU|AA|UU)$/u.test(status) ||
        /^(?: [MATD]|[MTA][ MTD]|D )$/u.test(status))) fail();
    start = end + 1;
  }
  return false;
}
