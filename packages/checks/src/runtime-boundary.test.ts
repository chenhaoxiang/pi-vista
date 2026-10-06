import { deepStrictEqual, doesNotMatch, strictEqual } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// Read package build products only, never sessions, stores, or owner artifacts.
test("checks emitted runtime has only local/node:util imports and no I/O, execution or persistence APIs", () => {
  const dist = new URL("../dist/", import.meta.url);
  const modules = readdirSync(dist).filter((name) => name.endsWith(".js")).sort();
  deepStrictEqual(modules, ["bindings.js", "contract.js", "index.js", "input.js", "registry.js", "runner.js"]);
  for (const name of modules) {
    const source = readFileSync(new URL(name, dist), "utf8");
    const imports = [...source.matchAll(/\bfrom\s+"([^"]+)"/gu)].map((match) => match[1]!);
    for (const specifier of imports) strictEqual(specifier === "node:util" || /^\.\/[a-z-]+\.js$/u.test(specifier), true, `${name}: ${specifier}`);
    doesNotMatch(source, /\b(?:import\s*\(|eval\s*\(|new\s+Function\b|require\s*\(|process\s*\.|fetch\s*\(|exec\s*\(|spawn\s*\()/u, name);
    doesNotMatch(source, /node:(?:fs|http|https|net|child_process|worker_threads)|hindsight/iu, name);
  }
});
