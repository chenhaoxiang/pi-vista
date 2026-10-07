import { CheckRegistry, type CheckInvocation, type CheckHandler } from "@pi-vista/checks";
import {
  fail, snapshotConfig, type LocalCheckConfig,
} from "./config.js";
import { active, repositoryDirectory, targetExists } from "./filesystem.js";
import { branchExists, headMatches, validateRepository, worktreeClean } from "./git.js";

export {
  LocalCheckError, MAX_ROOTS, MAX_REPOSITORIES, MAX_SUBJECTS,
  MAX_RELATIVE_LENGTH, MAX_PATH_DEPTH, GIT_TIMEOUT_MS, GIT_MAX_BUFFER,
} from "./config.js";
export type { LocalCheckConfig, LocalTarget, LocalBranch } from "./config.js";

function params(invocation: CheckInvocation, keys: readonly string[]): Readonly<Record<string, string>> {
  const values = invocation.definition.params;
  if (Object.keys(values).length !== keys.length || !keys.every((key) => Object.hasOwn(values, key))) fail();
  return values;
}

/** Fresh registry: never mutates an existing registry or replaces pure bindings. */
export async function createLocalCheckRegistry(config: LocalCheckConfig): Promise<CheckRegistry> {
  const snapshot = await snapshotConfig(config);
  const registry = new CheckRegistry();
  const register = (type: Parameters<CheckRegistry["register"]>[0], handler: CheckHandler): void => {
    registry.register(type, async (invocation) => {
      try {
        active(invocation.signal);
        return await handler(invocation);
      } catch {
        return fail();
      }
    });
  };
  for (const type of ["path_exists", "path_not_exists"] as const) {
    register(type, async (invocation) => {
      const { subject } = params(invocation, ["subject"]);
      const target = snapshot.targets.get(subject!);
      if (target === undefined) fail();
      const exists = await targetExists(snapshot, target, invocation.signal);
      return type === "path_exists" ? exists : !exists;
    });
  }
  for (const type of ["sha_matches", "branch_exists", "branch_not_exists", "worktree_clean"] as const) {
    register(type, async (invocation) => {
      const values = params(invocation, type === "sha_matches" ? ["repo", "expected"] :
        type === "worktree_clean" ? ["repo"] : ["repo", "subject"]);
      const target = snapshot.repositories.get(values.repo!);
      if (target === undefined) fail();
      const branch = type === "branch_exists" || type === "branch_not_exists" ? snapshot.branches.get(values.subject!) : undefined;
      if ((type === "branch_exists" || type === "branch_not_exists") && (branch === undefined || branch.repo !== values.repo)) fail();
      if (type === "sha_matches" && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(values.expected!)) fail();
      // Type-specific schema and aliases are resolved before this probe's first read.
      const repo = await repositoryDirectory(snapshot, target, invocation.signal);
      await validateRepository(snapshot, repo, invocation.signal);
      if (type === "sha_matches") return headMatches(snapshot, repo, values.expected!, invocation.signal);
      if (type === "worktree_clean") return worktreeClean(snapshot, repo, invocation.signal);
      const exists = await branchExists(snapshot, repo, branch!.ref, invocation.signal);
      return type === "branch_exists" ? exists : !exists;
    });
  }
  return registry;
}
