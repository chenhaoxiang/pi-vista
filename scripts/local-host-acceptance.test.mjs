import { strict as assert } from "node:assert";
import test from "node:test";
import { localHostOptions, localHostAcceptance, createHostPlanLedger, nativeSuite } from "./local-host-acceptance.mjs";

const args = ["--allow-local", `--source-sha=${"a".repeat(40)}`, "--namespace=local-fixture", "--deadline-ms=100000"];
const counts = { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, file_wrappers: 1 };
const native = () => ({ schema: 1, files: ["/fixture/owned.test.js"], counts: { ...counts } });

test("local host command requires explicit complete options and never accepts network/live flags", () => {
  const options = localHostOptions(args); assert.ok(Object.isFrozen(options)); assert.equal(options.allow_local, true);
  for (const invalid of [[], args.slice(1), args.slice(0, 3), [...args, "--network"], [...args, "--allow-live"],
    [...args, "--allow-local"], args.map(x => x.startsWith("--source-sha") ? "--source-sha=short" : x),
    args.map(x => x.startsWith("--deadline") ? "--deadline-ms=0" : x),
    args.map(x => x.startsWith("--deadline") ? "--deadline-ms=1200001" : x),
    args.map(x => x.startsWith("--namespace") ? "--namespace=../other" : x),
    args.map(x => x.startsWith("--namespace") ? "--namespace=wrapped_ghp_abcdefghijklmnop" : x)])
    assert.throws(() => localHostOptions(invalid));
});
test("effectful entry refuses malformed/accessor/proxy/coercion input before any command", async () => {
  let called = 0;
  const proxy = new Proxy({}, { get() { called++; throw Error(); }, ownKeys() { called++; throw Error(); } });
  const accessor = { ...localHostOptions(args) }; Object.defineProperty(accessor, "namespace", { get() { called++; throw Error(); } });
  const coercion = { toString() { called++; throw Error(); } };
  for (const bad of [proxy, accessor, { ...localHostOptions(args), namespace: coercion }, { ...localHostOptions(args), extra: true }, { allow_local: false }, null])
    await assert.rejects(() => localHostAcceptance(bad));
  assert.equal(called, 0);
});
test("declared process plan records all admissions and settlements, not OS coverage", () => {
  const ledger = createHostPlanLedger(["source", "consumer"]);
  assert.deepEqual(ledger.details(), { coverage: "partial", event_count: 0, blocked: 0, dropped: 0 });
  ledger.admit("source"); ledger.settle("source", true);
  assert.equal(ledger.details().coverage, "partial"); ledger.admit("consumer"); ledger.settle("consumer", true);
  assert.deepEqual(ledger.details(), { coverage: "complete", event_count: 4, blocked: 0, dropped: 0 });
  assert.ok(Object.isFrozen(ledger.details()));
});
for (const name of ["unknown", "duplicate", "unsettled", "failed", "duplicate-settle"]) {
  test(`local plan ${name} cannot become clean complete coverage`, () => {
    const ledger = createHostPlanLedger(["source"]);
    if (name === "unknown") assert.throws(() => ledger.admit("other"));
    else if (name === "unsettled") ledger.admit("source");
    else {
      ledger.admit("source"); ledger.settle("source", name !== "failed");
      if (name === "duplicate") assert.throws(() => ledger.admit("source"));
      if (name === "duplicate-settle") assert.throws(() => ledger.settle("source", true));
    }
    const details = ledger.details(); assert.ok(details.coverage !== "complete" || details.blocked > 0);
  });
}
test("plan definition duplicates/empty/unsafe names and unadmitted settlement refuse", () => {
  for (const plan of [[], ["one", "one"], ["../outside"], ["x".repeat(65)], true]) assert.throws(() => createHostPlanLedger(plan));
  const ledger = createHostPlanLedger(["one"]); assert.throws(() => ledger.settle("one", true)); assert.equal(ledger.details().blocked, 1);
});
test("native case suite separates real test counts from file wrappers and suites", () => {
  const report = native(); report.counts.file_wrappers = 5; report.counts.suites = 3;
  assert.deepEqual(nativeSuite(report, report.files), { name: "evidence-native", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 });
});
for (const field of ["failed", "cancelled", "skipped", "todo"]) {
  test(`native ${field} cannot be source PASS`, () => {
    const report = native(); report.counts[field] = 1; report.counts.passed = 1;
    assert.throws(() => nativeSuite(report, report.files));
  });
}
test("zero cases, forged stdout report fields, file mismatch and inconsistent counters refuse", () => {
  for (const change of [r => { r.counts.tests = 0; r.counts.passed = 0; }, r => { r.stdout_passed = true; },
    r => { r.counts.tests = 9; }, r => { r.schema = 2; }]) {
    const report = native(); change(report); assert.throws(() => nativeSuite(report, report.files));
  }
  const report = native(); assert.throws(() => nativeSuite(report, ["/fixture/other.test.js"]));
});
