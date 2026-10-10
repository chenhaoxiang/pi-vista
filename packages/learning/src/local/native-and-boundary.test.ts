import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createLocalLearningLibrary } from "./index.js";
import { errorCode, expected, fixture, observation, query, scope } from "./local.fixtures.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../../tmp/local-learning-process/", import.meta.url));

test("LOCAL independent native process cannot restore serialized live proof/handle/plan/selection", { timeout: 20_000 }, async () => {
  await mkdir(root, { recursive: true }); const owned = await mkdtemp(path.join(root, "case-"));
  const local = new URL("./index.js", import.meta.url).href; const fixtures = new URL("./local.fixtures.js", import.meta.url).href;
  const code = (phase: string, previous?: unknown) => `
    import { createLocalLearningLibrary } from ${JSON.stringify(local)};
    import { fixture, verified, expected, observation, query, selected } from ${JSON.stringify(fixtures)};
    const f = fixture(); let result;
    if (${JSON.stringify(phase)} === 'write') {
      const handle = await verified(f); const plan = f.library.prepareGuidance(handle, 'fixture-alias');
      const proof = await f.proof(); const selection = f.library.retrieve([handle], query);
      const persisted = await f.library.commitGuidance(plan, {preview_digest:plan.preview_digest});
      const history = await f.library.readGuidance(persisted.persistence);
      result = {pid:process.pid, handle:persisted, plan, proof, selection, history};
    } else {
      const old = ${JSON.stringify(previous ?? null)};
      const codes = {};
      try { f.library.nominate(old.handle); } catch(e) { codes.handle = e.code; }
      try { await f.library.commitGuidance(old.plan, {preview_digest:old.plan.preview_digest}); } catch(e) { codes.plan = e.code; }
      try { f.library.compileContext(old.selection); } catch(e) { codes.selection = e.code; }
      const candidate = f.library.nominate(f.library.observe(observation('new-example')));
      try { f.library.verifyCandidate(candidate, old.proof); } catch(e) { codes.proof = e.code; }
      try { f.library.importGuidance(old.history, {...expected,experience_id:'new-history',run_id:'new-run',ts:10001}); } catch(e) { codes.history = e.code; }
      // An explicit original read through trusted host callbacks remints a history
      // view only; there is still no current proof, retain or status restoration.
      const lib = createLocalLearningLibrary({...f.config, store:{...f.store, read: async()=>old.history}});
      const reread = await lib.readGuidance(old.handle.persistence);
      const seen = lib.importGuidance(reread,{...expected,experience_id:'new-history',run_id:'new-run',ts:10001});
      result = {pid:process.pid,codes,history_status:seen.status,current_verification:reread.current_verification,authorization:seen.authorization,executable:seen.executable,retain:f.calls.retain,proof:seen.verification??null};
    }
    console.log(JSON.stringify(result)); f.library.shutdown(); f.verifier.shutdown();
  `;
  const run = async (phase: string, previous?: unknown) => {
    const output = await exec(process.execPath, ["--input-type=module", "-e", code(phase, previous)], {
      cwd: owned, env: { PATH: path.dirname(process.execPath), HOME: owned, TMPDIR: owned }, timeout: 10_000, maxBuffer: 65_536, shell: false,
    }); assert.equal(output.stderr, ""); return JSON.parse(output.stdout);
  };
  try {
    const first = await run("write"); const next = await run("read", first); assert.notEqual(first.pid, next.pid);
    assert.deepEqual(next.codes, { handle: "invalid-handle", plan: "invalid-plan", selection: "stale-selection", proof: "unverified-evidence", history: "stale-history" });
    assert.equal(next.history_status, "observed"); assert.equal(next.current_verification, "not-checked"); assert.equal(next.authorization, "none"); assert.equal(next.executable, false);
    assert.equal(next.retain, 0); assert.equal(next.proof, null);
  } finally { await rm(owned, { recursive: true, force: true }); }
});
test("LOCAL subpath is explicit; prior root/signed/guidance source entry points remain unchanged", async () => {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
  assert.deepEqual(manifest.exports["./local"], { types: "./dist/local/index.d.ts", import: "./dist/local/index.js" });
  const rootEntry = await readFile(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
  assert.equal(rootEntry.includes("./local/"), false); assert.equal(rootEntry.includes("isLocalEvidenceVerifier"), false);
  const publicModule = await import("@pi-vista/learning/local"); assert.equal(typeof publicModule.createLocalLearningLibrary, "function");
  const rootModule = await import("@pi-vista/learning"); assert.equal(Object.hasOwn(rootModule, "createLocalLearningLibrary"), false);
  assert.equal(Object.hasOwn(publicModule, "createHindsightGuidanceStore"), false);
});
test("LOCAL fulfilled promise shadow then and hostile raw DTO descriptors never execute", async () => {
  const f = fixture(); let traps = 0;
  const malformed = { bank: "fixture-alias" }; const fulfilled = Promise.resolve(malformed);
  Object.defineProperty(malformed, "then", { get() { traps++; throw Error("private getter"); } });
  Object.defineProperty(fulfilled, "then", { get() { traps++; throw Error("private promise getter"); } });
  const lib = createLocalLearningLibrary({ ...f.config, store: { ...f.store, retain: (() => fulfilled) as any } });
  const h = lib.verifyCandidate(lib.nominate(lib.observe(observation())), await f.proof()); const p = lib.prepareGuidance(h, "fixture-alias");
  await assert.rejects(() => lib.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-mismatch")); assert.equal(traps, 0);
});
test("LOCAL proxies and hostile error prototypes are value-free without reflection traps", async () => {
  for (const shape of ["proxy", "prototype", "code-getter"]) {
    const f = fixture(); let traps = 0; const poison = new Proxy({}, { getPrototypeOf() { traps++; throw Error("private trap"); }, get() { traps++; throw Error("private trap"); } });
    let failure: unknown = poison;
    if (shape === "prototype") failure = Object.create(poison);
    if (shape === "code-getter") { const { LearningError } = await import("../contract.js"); failure = Object.defineProperty(new LearningError("sink-failed"), "code", { get() { traps++; throw Error("private trap"); } }); }
    const lib = createLocalLearningLibrary({ ...f.config, store: { ...f.store, retain: async () => { throw failure; } } });
    const h = lib.verifyCandidate(lib.nominate(lib.observe(observation())), await f.proof()); const p = lib.prepareGuidance(h, "fixture-alias");
    await assert.rejects(() => lib.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-failed")); assert.equal(traps, 0);
  }
});
test("LOCAL required explicit scope cannot be supplied by inherited configuration", () => {
  const f = fixture(); let gets = 0; const parent = Object.getOwnPropertyDescriptor(Object.prototype, "scope");
  Object.defineProperty(Object.prototype, "scope", { configurable: true, get() { gets++; return scope; } });
  try {
    assert.throws(() => createLocalLearningLibrary({ mode: "local-learning", verifier: f.verifier } as any), errorCode("invalid-config"));
    assert.equal(gets, 0);
  } finally { if (parent) Object.defineProperty(Object.prototype, "scope", parent); else delete (Object.prototype as any).scope; }
});
