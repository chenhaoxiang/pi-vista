import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { snapshotPiWorkRef, snapshotPiWorkBinding, samePiWorkRef, samePiWorkBinding, VistaProtocolError } from "./index.js";

const work = { owner: "example/maintenance", kind: "change", key: "existing-change" } as const;
const binding = { workRef: work, stageId: "source", runId: "run-1", sessionId: "session-1", revision: 1, headSha: "a".repeat(40) };

test("work references preserve exact owner/kind/key and detach their binding", () => {
  const input = { ...binding, workRef: { ...work, key: String(work.key) } };
  const snapshot = snapshotPiWorkBinding(input);
  deepStrictEqual(snapshot, input);
  input.workRef.key = "changed";
  strictEqual(snapshot.workRef.key, "existing-change");
  strictEqual(Object.isFrozen(snapshot), true);
  strictEqual(Object.isFrozen(snapshot.workRef), true);
  strictEqual(samePiWorkBinding(snapshot, snapshotPiWorkBinding(binding)), true);
  strictEqual(samePiWorkRef(snapshot.workRef, { ...work, owner: "other/maintenance" }), false);
  strictEqual(samePiWorkBinding(snapshot, { ...snapshot, runId: "run-2" }), false);
  strictEqual(samePiWorkBinding(snapshot, { ...snapshot, headSha: "b".repeat(40) }), false);
});

test("work references reject private paths, extras, ambiguous data and non-exact heads", () => {
  for (const value of [
    { ...work, key: "/private/task.md" },
    { ...work, owner: "../private" },
    { ...work, kind: "session" },
    { ...work, raw: "payload" },
    { ...work, key: ".." },
    { ...work, key: "x".repeat(129) },
  ]) throws(() => snapshotPiWorkRef(value), VistaProtocolError);
  for (const value of [
    { ...binding, revision: -1 }, { ...binding, revision: NaN }, { ...binding, revision: 1.5 },
    { ...binding, headSha: "abc" }, { ...binding, headSha: "A".repeat(40) },
    { ...binding, stageId: "../private" }, { ...binding, sessionId: "cat-private-data".repeat(20) },
    { ...binding, raw: "/private/notes" },
  ]) {
    throws(() => snapshotPiWorkBinding(value), VistaProtocolError);
  }
});

test("work metadata getters and proxies never execute", () => {
  let reads = 0;
  const getter = { ...work, get key() { reads += 1; return "secret"; } };
  throws(() => snapshotPiWorkRef(getter), VistaProtocolError);
  const proxy = new Proxy({ ...work }, { ownKeys() { reads += 1; return []; } });
  throws(() => snapshotPiWorkRef(proxy), VistaProtocolError);
  throws(() => snapshotPiWorkBinding({ ...binding, get workRef() { reads += 1; return work; } }), VistaProtocolError);
  throws(() => snapshotPiWorkBinding({ ...binding, workRef: proxy }), VistaProtocolError);
  const revoked = Proxy.revocable({ ...binding }, {});
  revoked.revoke();
  throws(() => snapshotPiWorkBinding(revoked.proxy), VistaProtocolError);
  strictEqual(samePiWorkRef(getter, work), false);
  strictEqual(samePiWorkRef(work, proxy), false);
  strictEqual(samePiWorkBinding(binding, revoked.proxy), false);
  strictEqual(samePiWorkBinding({ ...binding, get headSha() { reads += 1; return binding.headSha; } }, binding), false);
  strictEqual(reads, 0);
});

test("work binding preserves every dimension, including owner kind/key and a 64-digit exact head", () => {
  const snapshot = snapshotPiWorkBinding(binding);
  for (const other of [
    { ...binding, stageId: "delivery" }, { ...binding, sessionId: "session-2" }, { ...binding, revision: 2 },
    { ...binding, workRef: { ...work, kind: "task" as const } },
    { ...binding, workRef: { ...work, key: "another-change" } },
  ]) strictEqual(samePiWorkBinding(snapshot, other), false);
  strictEqual(snapshotPiWorkBinding({ ...binding, headSha: "a".repeat(64) }).headSha, "a".repeat(64));
});

test("work reference validation errors are independent of invalid private values", () => {
  const messages: string[] = [];
  for (const key of ["/private/owner-task.md", "echo secret && cat private", "sk-1234567890abcdefghijklmnopqrstuv"]) {
    throws(() => snapshotPiWorkRef({ ...work, key }), (error: unknown) => {
      strictEqual(error instanceof VistaProtocolError, true);
      messages.push((error as Error).message);
      strictEqual((error as Error).message.includes(key), false);
      return true;
    });
  }
  strictEqual(new Set(messages).size, 1);
});
