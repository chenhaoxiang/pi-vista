import test from "node:test";
import assert from "node:assert/strict";
import { LearningError } from "../contract.js";
import { hash } from "../data.js";
import { prepareHistoricalGuidance } from "../guidance/index.js";
import { document, receipt, writeRequest } from "../guidance/data.js";
import { errorCode, fixture, observation, reference, verified } from "./local.fixtures.js";

test("LOCAL F1 malformed canonical input never exposes JSON error/body/stack or reaches reconciliation", async () => {
  const f = fixture(); const valid = prepareHistoricalGuidance(observation()); const marker = "fixture-malformed-private-marker";
  for (const content of [`{${marker}`, `{\"${marker}\":`]) {
    const malformed = { ...valid, content, content_digest: hash(content) };
    await assert.rejects(() => f.library.reconcileGuidance("fixture-alias", malformed), e => e instanceof LearningError &&
      e.code === "invalid-input" && e.message === "invalid-input" && e.stack === "LearningError: invalid-input" && !JSON.stringify(e).includes(marker));
  }
  assert.deepEqual(f.calls, { collect: 0, retain: 0, read: 0, query: 0, reconcile: 0 });
  assert.equal((await f.library.reconcileGuidance("fixture-alias", valid)).state, "not-confirmed"); assert.equal(f.calls.reconcile, 1);
});
test("LOCAL F2 matching bad-suffix receipt/readback cannot mint persistence or issue an original read", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias");
  const good = receipt(writeRequest(p.bank, p.document), "d".repeat(64));
  const bad = { ...good, document_id: `vista-guidance-v1-${"d".repeat(16)}-${"e".repeat(64)}` };
  f.state.retain = async () => bad; f.state.read = async () => ({ ...bad, ...document(p.document) });
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-mismatch"));
  assert.equal(h.persistence, undefined); assert.equal(f.calls.retain, 1); assert.equal(f.calls.read, 0);
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("promotion-used"));
});
test("LOCAL F2 reference-only original read must also match its derivable canonical suffix", async () => {
  const f = fixture(); const doc = prepareHistoricalGuidance(observation()); const good = receipt(writeRequest("fixture-alias", doc), "d".repeat(64));
  const bad = { ...good, document_id: `vista-guidance-v1-${"d".repeat(16)}-${"e".repeat(64)}` };
  f.state.read = async ref => ({ ...(ref.document_id === bad.document_id ? bad : good), ...document(doc) });
  await assert.rejects(() => f.library.readGuidance(reference(bad)), errorCode("sink-mismatch"));
  const valid = await f.library.readGuidance(reference(good)); assert.equal(valid.document.content, doc.content); assert.equal(valid.current_verification, "not-checked");
  assert.equal(f.calls.read, 2); assert.equal(f.calls.retain, 0);
});
test("LOCAL F2 paired receipt input refuses a bad suffix before any store callback", async () => {
  const f = fixture(); const good = receipt(writeRequest("fixture-alias", prepareHistoricalGuidance(observation())), "d".repeat(64));
  const bad = { ...good, document_id: `vista-guidance-v1-${"d".repeat(16)}-${"e".repeat(64)}` };
  await assert.rejects(() => f.library.readGuidance(bad), errorCode("invalid-input")); assert.equal(f.calls.read, 0); assert.equal(f.calls.retain, 0);
});
