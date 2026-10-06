import { CLI_VERSION, CliError, DEFAULT_LIMIT, MAX_ID_LENGTH, MAX_LABEL_LENGTH, MAX_LIMIT, MAX_OUTPUT_BYTES, NESTED_LIMIT, STATS_LIMIT } from "./contract.js";
import { observe } from "./observe.js";
import { parseArgs } from "./parse.js";
import { renderText } from "./render.js";

export { CLI_VERSION, CliError, DEFAULT_LIMIT, MAX_ID_LENGTH, MAX_LABEL_LENGTH, MAX_LIMIT, MAX_OUTPUT_BYTES, NESTED_LIMIT, STATS_LIMIT };
export type { ObservationRequest, ObservationView, ParsedCommand, Page } from "./contract.js";
export { observe, parseArgs };

export interface CliResult {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

export const HELP = `vista ${CLI_VERSION} — offline, read-only recorded observations

Usage:
  vista history [run_id]
  vista inspect <run_id> [--step <step_id>]
  vista compare <run_id_a> <run_id_b>
  vista receipts <run_id>

Observation options (before or after the command):
  --base-dir <directory>  Read another local store (default: core default store)
  --json                  Render the closed, sanitized JSON view
  --limit <1-${MAX_LIMIT}>         Maximum entries per top-level list (default: ${DEFAULT_LIMIT})
  --step <step_id>         Inspect only a core run-bound step

Information options (alone, or with only a command name):
  --help, -h              Show this help without reading storage
  --version               Show the CLI package version without reading storage

Core readers are best-effort: empty output does not prove absent evidence.
All metadata is recorded-only, not independent verification or authorization.
No artifact content, hooks, model calls, replay, promotion, or network access.
`;

/** Returns process-ready output without printing errors, paths, arguments, or stacks. */
export async function runCli(argv: readonly string[]): Promise<CliResult> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.kind === "help") return { exitCode: 0, stdout: HELP, stderr: "" };
    if (parsed.kind === "version") return { exitCode: 0, stdout: `${CLI_VERSION}\n`, stderr: "" };
    const view = await observe(parsed.request);
    const stdout = parsed.json ? `${JSON.stringify(view)}\n` : renderText(view);
    if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) throw new CliError("output");
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    if (error instanceof CliError && error.code === "usage") {
      return { exitCode: 2, stdout: "", stderr: "vista: invalid arguments. Use vista --help.\n" };
    }
    return { exitCode: 1, stdout: "", stderr: error instanceof CliError && error.code === "output" ? "vista: output limit exceeded.\n" : "vista: observation unavailable.\n" };
  }
}
