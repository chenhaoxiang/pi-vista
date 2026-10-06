import fs from "node:fs/promises";
import { join } from "node:path";
import type { Stats } from "node:fs";
import { fail, relativeParts, type ConfigSnapshot, type LocalTarget } from "./config.js";

export function active(signal: AbortSignal): void {
  if (signal.aborted) fail();
}

async function stat(path: string, signal: AbortSignal, missing: boolean): Promise<Stats | undefined> {
  active(signal);
  let result: Stats;
  try {
    result = await fs.lstat(path);
  } catch (error) {
    active(signal);
    // Only a genuine lstat ENOENT in an already-walked namespace is absence.
    if (missing && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return fail();
  }
  active(signal);
  if (result.isSymbolicLink() || (!result.isFile() && !result.isDirectory())) fail();
  return result;
}

export async function rootDirectory(path: string, signal: AbortSignal): Promise<void> {
  const result = await stat(path, signal, false);
  if (!result?.isDirectory()) fail();
  active(signal);
  const canonical = await fs.realpath(path);
  active(signal);
  if (canonical !== path) fail();
}

/** Reject each ancestor/leaf symlink before any further traversal. Not race-proof. */
export async function walk(root: string, parts: readonly string[], signal: AbortSignal, missing: boolean): Promise<Stats | undefined> {
  let current = root;
  let result: Stats | undefined;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    result = await stat(current, signal, missing);
    if (result === undefined) return undefined;
    if (index < parts.length - 1 && !result.isDirectory()) fail();
  }
  return parts.length === 0 ? stat(root, signal, false) : result;
}

export async function targetExists(config: ConfigSnapshot, target: LocalTarget, signal: AbortSignal): Promise<boolean> {
  const root = config.roots.get(target.root)!;
  await rootDirectory(root, signal);
  return (await walk(root, relativeParts(target.relativePath), signal, true)) !== undefined;
}

/** Ordinary repositories only: an own .git directory is required before Git. */
export async function repositoryDirectory(config: ConfigSnapshot, target: LocalTarget, signal: AbortSignal): Promise<string> {
  const root = config.roots.get(target.root)!;
  await rootDirectory(root, signal);
  const parts = relativeParts(target.relativePath);
  if (!(await walk(root, parts, signal, false))?.isDirectory()) fail();
  const repo = join(root, ...parts);
  if (!(await walk(repo, [".git"], signal, false))?.isDirectory()) fail();
  return repo;
}
