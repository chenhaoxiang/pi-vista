import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { toVistaEventInput, type ShadowObservation } from "@pi-vista/adapter-shadow";
import { asset, binding, FAMILIES, fixedError, HASH, mutable, observation, OTHER_HASH, row } from "./fixtures.mjs";

function map(value: unknown): unknown {
  return toVistaEventInput(value as ShadowObservation);
}

const BOUNDARIES = [
  ["observation", () => observation(), (value: unknown) => value],
  ["correlation", () => binding(), (value: unknown) => observation({ correlation: value })],
  ["request", () => binding(), (value: unknown) => observation({ request: value })],
  ["vote", () => binding(), (value: unknown) => observation({ vote: value })],
  ["row_evidence", () => row(), (value: unknown) => observation({ row_evidence: value })],
  ["asset_evidence", () => asset(), (value: unknown) => observation({ asset_evidence: value })],
] as const;

for (const [name, make, wrap] of BOUNDARIES) {
  test(`validation ${name}: rejects accessors, symbols, custom prototypes, unknown keys and undefined without execution`, () => {
    let reads = 0;
    const accessor = mutable(make());
    Object.defineProperty(accessor, Object.keys(accessor)[0]!, { get() { reads++; throw new Error("private-source-error"); } });
    throws(() => map(wrap(accessor)), fixedError);
    strictEqual(reads, 0);
    for (const value of [null, 1, "raw", false, [], () => make(), new Date(), new Map()]) throws(() => map(wrap(value)), fixedError);
    const symbol = mutable(make());
    Object.defineProperty(symbol, Symbol("private-symbol"), { value: "private-value" });
    throws(() => map(wrap(symbol)), fixedError);
    const custom = Object.assign(Object.create({ dangerous: true }), make()) as unknown;
    throws(() => map(wrap(custom)), fixedError);
    const unknown = mutable(make());
    Object.defineProperty(unknown, "/private/source-command", { get() { reads++; return "private-value"; } });
    throws(() => map(wrap(unknown)), fixedError);
    strictEqual(reads, 0);
    const undefinedValue = mutable(make());
    undefinedValue[Object.keys(undefinedValue)[0]!] = undefined;
    throws(() => map(wrap(undefinedValue)), fixedError);
  });

  test(`validation ${name}: all Proxies and revoked Proxies reject with zero source traps`, () => {
    let traps = 0;
    const trap = (): never => { traps++; throw new Error("private-proxy-error"); };
    const handler: ProxyHandler<object> = { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, has: trap };
    const proxy = new Proxy(make(), handler);
    throws(() => map(wrap(proxy)), fixedError);
    const revoked = Proxy.revocable(make(), handler);
    revoked.revoke();
    throws(() => map(wrap(revoked.proxy)), fixedError);
    strictEqual(traps, 0);
  });

  test(`validation ${name}: plain/null-prototype and non-enumerable own data have identical projections`, () => {
    const ordinary = make();
    const nullPrototype = Object.assign(Object.create(null), ordinary) as unknown;
    deepStrictEqual(map(wrap(nullPrototype)), map(wrap(ordinary)));
    const nonEnumerable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ordinary)) Object.defineProperty(nonEnumerable, key, { value });
    deepStrictEqual(map(wrap(nonEnumerable)), map(wrap(ordinary)));
  });
}

test("required normalization schema/model/outcomes and false eligibility fields are closed", () => {
  const required = ["schema", "shadow", "model_family", "model_id", "model_version", "verdict", "status", "context_status", "correlation",
    "humanExpectationWritten", "trainingEligible", "promotionEligible"];
  for (const key of required) {
    const input = mutable(observation());
    delete input[key];
    throws(() => map(input), fixedError, key);
    throws(() => map(observation({ [key]: undefined })), fixedError, key);
  }
  for (const key of ["humanExpectationWritten", "trainingEligible", "promotionEligible"]) {
    for (const value of [true, 1, 0, "false", null]) throws(() => map(observation({ [key]: value })), fixedError);
  }
  for (const key of ["authorized", "verified", "active", "live", "popup", "training", "promotion", "humanExpectation", "permission", "PASS", "result"]) {
    throws(() => map(observation({ [key]: key === "result" ? "ok" : true })), fixedError);
  }
  for (const [key, value] of [
    ["schema", "legacy-shadow/1"], ["schema", "shadow-observation/2"], ["shadow", false],
    ["verdict", "PASS"], ["verdict", "success"], ["status", "verified"], ["status", "allow"],
    ["context_status", "good"], ["model_family", "judge"], ["model_family", "toString"],
  ] as const) throws(() => map(observation({ [key]: value })), fixedError);
});

test("known model identities cannot be cross-labelled as another normalized family", () => {
  for (const [model_family] of FAMILIES) {
    for (const [other_family, model_id] of FAMILIES) {
      if (model_family !== other_family) throws(() => map(observation({ model_family, model_id })), fixedError);
    }
  }
  for (const model_family of ["intern", "startlux"]) {
    for (const model_id of ["laya-421m", "kev-4b", "unknown-model", model_family === "intern" ? "startlux-decision-4b" : "intern-decision-4b"]) {
      throws(() => map(observation({ model_family, model_id })), fixedError);
    }
  }
});

test("confidence is finite unit-range primitive metadata only", () => {
  for (const confidence of [NaN, Infinity, -Infinity, -0.1, 1.1, "1", null, undefined, new Number(1)]) {
    throws(() => map(observation({ confidence })), fixedError);
  }
  for (const confidence of [0, 0.5, 1]) strictEqual(toVistaEventInput(observation({ confidence })).result, "unknown");
});

test("raw owner requests/votes/wire packets/row proofs and arbitrary legacy objects are unsupported", () => {
  for (const value of [
    { request_id: "req", scope: {}, fingerprint: HASH, policy_version: "owner-v1", model_versions: { laya: "synthetic-laya-1", kev: "synthetic-kev-1" } },
    { judge: "laya", verdict: "allow", version: "synthetic-laya-1", request_id: "req", fingerprint: HASH, policy_version: "owner-v1" },
    { command: "synthetic command", rule: "rule-1", reason: "reason-1", context: "worktree" },
    { schema: "laya-row-council-proof/1", models: [], humanExpectationWritten: false },
    { event: "decision.kev-shadow", detail: { verdict: "pass", shared_input_hash: HASH } },
  ]) throws(() => map(value), fixedError);
});

test("request/vote run, step, source, pair, fingerprint, policy and shared-input mismatches reject rather than repair", () => {
  const changes: Record<string, unknown> = {
    run_id: "other-run", step_id: "shadow-run_other", source_sha: OTHER_HASH,
    request_id: "other-request", pair_id: "other-pair", shared_input_hash: OTHER_HASH,
    fingerprint: HASH, policy_version: "other-policy",
  };
  for (const side of ["request", "vote"]) {
    for (const [key, value] of Object.entries(changes)) {
      for (const verdict of ["allow", "pass", "deny", "veto", "abstain", "uncertain", "unknown"]) {
        const input = observation({ [side]: binding({ [key]: value }), verdict });
        const before = JSON.stringify(input);
        throws(() => map(input), fixedError, `${side}.${key}`);
        strictEqual(JSON.stringify(input), before);
      }
    }
    const root = mutable(binding());
    delete root.shared_input_hash;
    throws(() => map(observation({ correlation: root, [side]: binding() })), fixedError);
  }
  throws(() => map(observation({ correlation: binding({ step_id: "different-run_0" }) })), fixedError);
  throws(() => map(observation({ correlation: binding({ run_id: undefined }) })), fixedError);
});

test("row and isolated receipt evidence cannot assert truth/verification or real-input isolation", () => {
  for (const key of ["verified", "realInputIsolationProven"]) {
    for (const value of [true, "false", 0, undefined]) throws(() => map(observation({ asset_evidence: asset({ [key]: value }) })), fixedError);
  }
  for (const key of ["humanExpectationWritten", "trainingEligible", "promotionEligible", "humanExpectation", "PASS"]) {
    throws(() => map(observation({ row_evidence: row({ [key]: true }) })), fixedError);
    throws(() => map(observation({ asset_evidence: asset({ [key]: true }) })), fixedError);
  }
  throws(() => map(observation({ row_evidence: row({ ownerAdjudicationRequired: false }) })), fixedError);
  throws(() => map(observation({ row_evidence: row({ ownerReviewCandidate: "true" }) })), fixedError);
  throws(() => map(observation({ row_evidence: row({ forcedAbstain: "false" }) })), fixedError);
  for (const scope of ["live", "production", "real-input", null]) throws(() => map(observation({ asset_evidence: asset({ scope }) })), fixedError);
  for (const license_mode of ["commercial", "production", "approved", null]) throws(() => map(observation({ asset_evidence: asset({ license_mode }) })), fixedError);
  const empty = mutable(asset());
  for (const key of ["asset_ref", "asset_sha256", "receipt_ref", "receipt_sha256", "isolation_ref", "isolation_sha256"]) delete empty[key];
  throws(() => map(observation({ asset_evidence: empty })), fixedError);
  for (const prefix of ["asset", "receipt", "isolation"]) {
    const evidence = mutable(asset());
    delete evidence[`${prefix}_ref`];
    throws(() => map(observation({ asset_evidence: evidence })), fixedError);
  }
});

const UNSAFE = [
  "", "/private/file", "C:\\private\\file", "./file", "../file", "relative/file", "~/file", "file%2Fprivate",
  "https://example.test/file", "https://example.test/file?%61ccess_token=private", "ref#private", "ref%253Fprivate",
  "git status", "pwd", "rm -rf synthetic", "$(whoami)", "ref;pwd", "ref\nprivate", "raw prompt body",
  "receipt_token-value", "ref-bearer-value", "cookie-1", "private-key-value", "API_key-value", "secret-value",
  ...[
    `ghp_${"A".repeat(36)}`, `github_pat_${"A".repeat(82)}`, `sk-${"A".repeat(36)}`,
    `xoxb-${"A".repeat(24)}`, `eyJ${"A".repeat(12)}.${"B".repeat(12)}.${"C".repeat(12)}`,
  ].flatMap((value) => [value, `receipt_${value}`, `safe${value}-ref`, `WRAP_${value.toUpperCase()}`]),
];

test("privacy: every retained label/ref/identity rejects paths, URLs, commands, content and wrapped credentials", () => {
  for (const value of UNSAFE) {
    for (const key of ["model_id", "model_version", "reason_code", "vote_ref"]) throws(() => map(observation({ [key]: value })), fixedError, key);
    for (const key of ["run_id", "step_id", "request_id", "pair_id", "policy_version"]) {
      throws(() => map(observation({ correlation: binding({ [key]: value }) })), fixedError, key);
    }
    throws(() => map(observation({ row_evidence: row({ sample_id: value }) })), fixedError);
    for (const key of ["asset_ref", "receipt_ref", "isolation_ref"]) throws(() => map(observation({ asset_evidence: asset({ [key]: value }) })), fixedError, key);
  }
  for (const key of ["command", "path", "cwd", "prompt", "output", "packet", "body", "receipt", "token", "authorization"]) {
    throws(() => map(observation({ [key]: "private-source" })), fixedError);
  }
});

test("bounded labels, IDs, references and exact SHA/digest grammars reject malformed source metadata", () => {
  throws(() => map(observation({ model_id: "a".repeat(129) })), fixedError);
  throws(() => map(observation({ model_version: "a".repeat(65) })), fixedError);
  throws(() => map(observation({ reason_code: "a".repeat(65) })), fixedError);
  throws(() => map(observation({ vote_ref: "a".repeat(257) })), fixedError);
  throws(() => map(observation({ correlation: binding({ request_id: "a".repeat(129) }) })), fixedError);
  for (const value of ["a".repeat(39), "a".repeat(41), "g".repeat(64), "a".repeat(65), "0x" + HASH, 1, null, undefined]) {
    throws(() => map(observation({ correlation: binding({ source_sha: value }) })), fixedError);
  }
  for (const value of ["a".repeat(40), "a".repeat(63), "g".repeat(64), "a".repeat(65), 1, null, undefined]) {
    for (const key of ["shared_input_hash", "fingerprint"]) throws(() => map(observation({ correlation: binding({ [key]: value }) })), fixedError);
    for (const key of ["row_sha256", "input_sha256", "packet_sha256", "contract_map_sha256"]) throws(() => map(observation({ row_evidence: row({ [key]: value }) })), fixedError);
    for (const key of ["asset_sha256", "receipt_sha256", "isolation_sha256"]) throws(() => map(observation({ asset_evidence: asset({ [key]: value }) })), fixedError);
  }
});

test("object-valued metadata is rejected without coercion or nested source inspection", () => {
  let reads = 0;
  const value = new Proxy({ toString() { reads++; return "safe"; } }, { get() { reads++; throw new Error("private-error"); } });
  for (const key of ["model_id", "model_version", "verdict", "confidence", "reason_code", "vote_ref"]) throws(() => map(observation({ [key]: value })), fixedError);
  throws(() => map(observation({ correlation: binding({ run_id: value }) })), fixedError);
  strictEqual(reads, 0);
});

test("inherited required fields never satisfy normalization and inherited getters are not read", () => {
  const input = mutable(observation());
  delete input.verdict;
  let reads = 0;
  Object.defineProperty(Object.prototype, "verdict", { configurable: true, get() { reads++; return "allow"; } });
  try { throws(() => map(input), fixedError); }
  finally { delete mutable(Object.prototype).verdict; }
  strictEqual(reads, 0);
});

// Compile-time public contract checks are not executed; synthetic runtime tests
// deliberately cast malformed JS above to exercise the actual boundary.
function publicTypeChecks(): void {
  const valid = observation();
  // @ts-expect-error positive promotion is outside the public contract
  const promotion: ShadowObservation = { ...valid, promotionEligible: true };
  // @ts-expect-error Intern cannot be identified as StartLux
  const mismatch: ShadowObservation = { ...valid, model_family: "intern", model_id: "startlux-decision-4b" };
  // @ts-expect-error mapped records are readonly
  toVistaEventInput(valid).result = "ok";
  void promotion; void mismatch;
}
void publicTypeChecks;
