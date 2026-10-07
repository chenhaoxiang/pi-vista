import { deepStrictEqual, doesNotMatch } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

test("checks-local emitted runtime stays in the explicit FS/Git seam without content, network or dynamic execution APIs", () => {
  const dist = new URL("../dist/", import.meta.url);
  const modules = readdirSync(dist).filter((name) => name.endsWith(".js")).sort();
  deepStrictEqual(modules, ["config.js", "filesystem.js", "git.js", "index.js"]);
  for (const name of modules) {
    const source = readFileSync(new URL(name, dist), "utf8");
    doesNotMatch(source, /\b(?:import\s*\(|eval\s*\(|new\s+Function\b|require\s*\(|process\s*\.|fetch\s*\()/u, name);
    doesNotMatch(source, /node:(?:http|https|net|tls|worker_threads)|hindsight/iu, name);
    doesNotMatch(source, /\.(?:readFile|writeFile|mkdir|rm|unlink|rename|open|createReadStream|createWriteStream)\s*\(/u, name);
    doesNotMatch(source, /shell:\s*true/u, name);
    if (name !== "git.js") doesNotMatch(source, /node:child_process|\.execFile\s*\(/u, name);
    if (name !== "filesystem.js") doesNotMatch(source, /node:fs/u, name);
  }
});
