import test from "node:test";
import assert from "node:assert/strict";
import * as root from "@pi-vista/learning";
import { createHindsightGuidanceStore, prepareHistoricalGuidance } from "@pi-vista/learning/guidance";

test("guidance public addon is distinct, never a root reexport or old LearningSink", () => {
  assert.equal(Object.hasOwn(root, "prepareHistoricalGuidance"), false); assert.equal(Object.hasOwn(root, "createHindsightGuidanceStore"), false);
  const store = createHindsightGuidanceStore({ mode: "local-guidance", endpoint: "https://example.invalid", banks: { "fixture-alias": "fixture-bank" }, journal_directory: "/private/fixture-absent" });
  assert.equal(Object.hasOwn(store, "sink"), false); assert.equal(Object.hasOwn(store, "ingest"), false);
  assert.equal(Object.hasOwn(store, "verify"), false); assert.equal(Object.hasOwn(store, "createBank"), false);
  assert.equal(typeof store.retain, "function"); assert.equal(typeof store.read, "function"); assert.ok(Object.isFrozen(store));
});
test("guidance closed historical content carries no status/signature/current-proof restoration", () => {
  const doc = prepareHistoricalGuidance({experience_id:"fixture-guide",run_id:"fixture-run",repo:"fixture-repo",source_sha:"a".repeat(40),policy_version:"fixture-v1",env_fingerprint:"fixture-env",task_type:"fixture-task",ts:1000,
    script:{task_type:"fixture-task",description:"inspect metadata",preconditions:[],steps:["fixture-inspection"],postconditions:[],known_failures:[],applicable_to:[]},
    steps:[{step_id:"fixture-step",tool:"fixture-reader",action_description:"inspect metadata",check_fn_ids:[],expected_result:"observed",on_failure:"stop",depends_on:[]}]});
  const saved=JSON.parse(doc.content);assert.equal(saved.purpose,"historical-guidance");assert.equal(saved.current_verification,"not-checked");assert.equal(saved.authorization,"none");assert.equal(saved.executable,false);
  assert.equal(Object.hasOwn(saved,"signature"),false);assert.equal(Object.hasOwn(saved.experience,"status"),false);
});
