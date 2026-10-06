import { CliError, MAX_LIMIT, type ObservationRequest, type ParsedCommand } from "./contract.js";
import { isBoundStep, isCliIdentifier } from "./safety.js";

const COMMANDS = new Set(["history", "inspect", "compare", "receipts"]);
const OPTIONS = new Set(["--json", "--base-dir", "--step", "--limit"]);
const COMMON_KEYS = ["command", "baseDir", "limit"];

function invalid(): never {
  throw new CliError("usage");
}

function validBaseDir(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4096 && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** Validate the public structured API as strictly as CLI arguments, including present undefined. */
export function validateRequest(input: ObservationRequest): ObservationRequest {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) invalid();
    const value = input as unknown as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || descriptor.value === undefined) invalid();
    }
    const command = value.command;
    if (typeof command !== "string" || !COMMANDS.has(command)) invalid();
    const commandKeys = command === "compare" ? ["runIdA", "runIdB"]
      : command === "inspect" ? ["runId", "stepId"] : ["runId"];
    const allowed = new Set([...COMMON_KEYS, ...commandKeys]);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.has(key)) invalid();
    }
    const has = (key: string): boolean => Object.hasOwn(value, key);
    if (!has("command")) invalid();
    if (has("baseDir") && !validBaseDir(value.baseDir)) invalid();
    if (has("limit") && (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > MAX_LIMIT)) invalid();
    const common = {
      ...(has("baseDir") ? { baseDir: value.baseDir as string } : {}),
      ...(has("limit") ? { limit: value.limit as number } : {}),
    };
    if (command === "compare") {
      if (!has("runIdA") || !has("runIdB") || !isCliIdentifier(value.runIdA) || !isCliIdentifier(value.runIdB)) invalid();
      return { command, runIdA: value.runIdA, runIdB: value.runIdB, ...common };
    }
    if (has("runId") && !isCliIdentifier(value.runId)) invalid();
    if (command !== "history" && !has("runId")) invalid();
    if (command === "inspect") {
      if (has("stepId") && !isBoundStep(value.runId, value.stepId)) invalid();
      return { command, runId: value.runId as string, ...(has("stepId") ? { stepId: value.stepId as string } : {}), ...common };
    }
    if (command === "receipts") return { command, runId: value.runId as string, ...common };
    return { command: "history", ...(has("runId") ? { runId: value.runId as string } : {}), ...common };
  } catch {
    return invalid();
  }
}

/** Options may precede or follow the command. Duplicate/unknown options are errors. */
export function parseArgs(argv: readonly string[]): ParsedCommand {
  if (!Array.isArray(argv) || argv.length > 32) invalid();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(value)) invalid();
  }
  if (argv.length === 0) return { kind: "help" };
  const info = argv.filter((arg) => arg === "--help" || arg === "-h" || arg === "--version");
  if (info.length > 0) {
    const rest = argv.filter((arg) => !info.includes(arg));
    if (info.length !== 1 || rest.length > 1 || (rest.length === 1 && !COMMANDS.has(rest[0]!))) invalid();
    return { kind: info[0] === "--version" ? "version" : "help" };
  }
  const seen = new Set<string>();
  const positionals: string[] = [];
  let json = false;
  let baseDir: string | undefined;
  let stepId: string | undefined;
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (!OPTIONS.has(arg) || seen.has(arg)) invalid();
    seen.add(arg);
    if (arg === "--json") {
      json = true;
      continue;
    }
    const next = argv[++index];
    if (next === undefined || next.startsWith("--")) invalid();
    if (arg === "--base-dir") {
      if (!validBaseDir(next)) invalid();
      baseDir = next;
    } else if (arg === "--step") {
      stepId = next;
    } else {
      if (!/^[1-9][0-9]{0,2}$/u.test(next)) invalid();
      limit = Number(next);
      if (limit > MAX_LIMIT) invalid();
    }
  }
  const [command, first, second] = positionals;
  const common = { ...(baseDir !== undefined ? { baseDir } : {}), ...(limit !== undefined ? { limit } : {}) };
  let request: ObservationRequest;
  if (command === "history" && positionals.length <= 2 && stepId === undefined) {
    request = { command, ...(first !== undefined ? { runId: first } : {}), ...common };
  } else if (command === "inspect" && positionals.length === 2 && first !== undefined) {
    request = { command, runId: first, ...(stepId !== undefined ? { stepId } : {}), ...common };
  } else if (command === "compare" && positionals.length === 3 && first !== undefined && second !== undefined && stepId === undefined) {
    request = { command, runIdA: first, runIdB: second, ...common };
  } else if (command === "receipts" && positionals.length === 2 && first !== undefined && stepId === undefined) {
    request = { command, runId: first, ...common };
  } else {
    return invalid();
  }
  return { kind: "observation", request: validateRequest(request), json };
}
