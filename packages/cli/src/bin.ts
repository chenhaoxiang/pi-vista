#!/usr/bin/env node

// Broken/closed output pipes must not surface Node's raw error objects.
process.stdout.on("error", () => { process.exitCode = 1; });
process.stderr.on("error", () => { process.exitCode = 1; });
try {
  const { runCli } = await import("./index.js");
  const result = await runCli(process.argv.slice(2));
  process.exitCode = result.exitCode;
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch {
  process.exitCode = 1;
  process.stderr.write("vista: observation unavailable.\n");
}
