import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventStore } from "@pi-vista/core";
import { isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, types } from "node:util";
import { snapshotPiWorkBinding, consumePiOwnerResult } from "@pi-vista/adapter-pi";
import { readSubagentFile } from "./pi-subagent-owner.mjs";
const isMain = url => process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]);

const exec = promisify(execFile), digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const integer = value => Number.isSafeInteger(value) && value > 0;
class CodeOwnerObservationError extends Error {
  constructor(reason) { super("code-owner-observation-unavailable"); this.reason = reason; }
}
function fail(reason) { throw new CodeOwnerObservationError(reason); }
function own(value, keys) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("contract_invalid");
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !keys.includes(key) || !d || !Object.hasOwn(d, "value")) fail("contract_invalid");
    out[key] = d.value;
  }
  return out;
}
function list(value, max = 16) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("contract_invalid");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > max || Reflect.ownKeys(value).length !== length + 1) fail("contract_invalid");
  const out = [];
  for (let i = 0; i < length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) fail("contract_invalid"); out.push(d.value); }
  return out;
}
function label(value) { if (typeof value !== "string" || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f]/u.test(value)) fail("contract_invalid"); return value; }
export function snapshotCodeOwnerContract(value) {
  const v = own(value, ["binding", "repository", "pullRequest", "baseRef", "headChecks", "mergeWorkflows", "gateReportFile", "repositoryReview"]);
  const binding = snapshotPiWorkBinding(v.binding);
  if (binding.stageId !== "source-shared-delivery" || !sha(binding.headSha)) fail("contract_invalid");
  if (typeof v.repository !== "string" || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/u.test(v.repository) || v.repository.length > 200 || v.repository.endsWith("/.") || v.repository.endsWith("/..")) fail("contract_invalid");
  if (!integer(v.pullRequest) || typeof v.baseRef !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,127}$/u.test(v.baseRef) || v.baseRef.includes("..")) fail("contract_invalid");
  let repositoryReview;
  if (v.repositoryReview !== undefined) {
    // First explicit independent-owner adoption, not a generic Gate bypass.
    // The trusted owner selects its already-accepted review original and pins
    // its full body. The reader checks identity/integrity, not prose or verdict.
    if (v.repository !== "chenhaoxiang/pi-desk" || v.gateReportFile !== undefined) fail("contract_invalid");
    const r = own(v.repositoryReview, ["commentId", "author", "bodySha256"]);
    if (!integer(r.commentId) || typeof r.author !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(r.author) || typeof r.bodySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(r.bodySha256)) fail("contract_invalid");
    repositoryReview = Object.freeze(r);
  } else if (typeof v.gateReportFile !== "string" || !isAbsolute(v.gateReportFile) || normalize(v.gateReportFile) !== v.gateReportFile || /[\x00-\x1f\x7f]/u.test(v.gateReportFile)) fail("contract_invalid");
  const headChecks = list(v.headChecks).map(raw => {
    const item = own(raw, ["name", "appId", "reviewHash"]), name = label(item.name);
    if (!integer(item.appId) || (item.reviewHash !== undefined && !/^[a-f0-9]{64}$/u.test(item.reviewHash))) fail("contract_invalid");
    return Object.freeze({ name, appId: item.appId, ...(item.reviewHash ? { reviewHash: item.reviewHash } : {}) });
  });
  const mergeWorkflows = list(v.mergeWorkflows).map(label);
  if (headChecks.length + mergeWorkflows.length > 30 || new Set(headChecks.map(x => `${x.appId}:${x.name}`)).size !== headChecks.length || new Set(mergeWorkflows).size !== mergeWorkflows.length) fail("contract_invalid");
  return Object.freeze({ binding, repository: v.repository, pullRequest: v.pullRequest, baseRef: v.baseRef,
    headChecks: Object.freeze(headChecks), mergeWorkflows: Object.freeze(mergeWorkflows), ...(repositoryReview ? { repositoryReview } : { gateReportFile: v.gateReportFile }) });
}

/** Trusted original JSON, optionally preceded by the existing Gate's human logs.
 * Never invokes Gate, merge, reconciliation, CI or a retry on read failure.
 */
export function parseOriginalGate(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes;
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024) fail("gate_original_invalid");
  const start = text.startsWith("{") ? 0 : text.indexOf("\n{\n  \"pass\"") + 1;
  if (start < 0 || (start === 0 && !text.startsWith("{"))) fail("gate_original_invalid");
  try { return JSON.parse(text.slice(start)); } catch { fail("gate_original_invalid"); }
}

// Fixed GET routes and fixed projections. gh uses its normal existing credential
// mechanism in-process; no tokens, bodies, private command text or errors escape.
export async function githubOriginal(kind, c, merge, { signal } = {}) {
  const prefix = `repos/${c.repository}`;
  const routes = {
    repository: [prefix, '{full_name,private,visibility}'],
    review: [`${prefix}/issues/comments/${c.repositoryReview?.commentId}`, '{id,user:{login:.user.login},issue_url,created_at,updated_at,body}'],
    pr: [`${prefix}/pulls/${c.pullRequest}`, '{number,state,draft,merged,merged_at,merge_commit_sha,head:{sha:.head.sha},base:{ref:.base.ref,repo:{full_name:.base.repo.full_name}}}'],
    checks: [`${prefix}/commits/${c.binding.headSha}/check-runs?per_page=100`, `${JSON.stringify(c.headChecks)} as $required | {total_count,check_runs:[.check_runs[] | . as $check | {id,name,head_sha,status,conclusion,started_at,completed_at,app:{id:.app.id},output:{summary:([$required[] | select(.name == $check.name and .appId == $check.app.id and .reviewHash != null) | .reviewHash as $hash | select(($check.output.summary // "") | contains($hash)) | $hash] | join(" "))}}]}`],
    workflows: [`${prefix}/actions/runs?head_sha=${merge}&event=push&branch=${encodeURIComponent(c.baseRef)}&per_page=100`, '{total_count,workflow_runs:[.workflow_runs[]|{id,name,head_sha,status,conclusion,event,head_branch,run_attempt,created_at,repository:{full_name:.repository.full_name}}]}'],
    ancestry: [`${prefix}/compare/${merge}...${encodeURIComponent(c.baseRef)}`, '{status,base_commit:{sha:.base_commit.sha}}'],
  };
  const route = routes[kind];
  try {
    const result = await exec("gh", ["api", "--hostname", "github.com", "--method", "GET", route[0], "--jq", route[1]], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, ...(signal ? { signal } : {}), env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" } });
    return JSON.parse(result.stdout);
  } catch { fail("github_original_unavailable"); }
}
function latest(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.some(x => !integer(x.id))) fail("required_original_missing");
  return [...rows].sort((a, b) => b.id - a.id)[0];
}
function selectChecks(checks, c) {
  if (!Array.isArray(checks.check_runs) || checks.total_count !== checks.check_runs.length || checks.check_runs.length > 100) fail("original_coverage_incomplete");
  return c.headChecks.map(requirement => {
    const row = latest(checks.check_runs.filter(x => x.name === requirement.name && x.app?.id === requirement.appId && x.head_sha === c.binding.headSha));
    if (row.status !== "completed" || row.conclusion !== "success") fail("source_check_not_successful");
    if (requirement.reviewHash && (typeof row.output?.summary !== "string" || !row.output.summary.includes(requirement.reviewHash))) fail("review_hash_mismatch");
    return { kind: "ci", ref: `check-${row.id}`, original: row };
  });
}
function selectWorkflows(workflows, c, merge) {
  if (!Array.isArray(workflows.workflow_runs) || workflows.total_count !== workflows.workflow_runs.length || workflows.workflow_runs.length > 100) fail("original_coverage_incomplete");
  return c.mergeWorkflows.map(name => {
    const row = latest(workflows.workflow_runs.filter(x => x.name === name && x.head_sha === merge && x.event === "push" && x.head_branch === c.baseRef && x.repository?.full_name === c.repository));
    if (row.status !== "completed" || row.conclusion !== "success") fail("merge_workflow_not_successful");
    return { kind: "ci", ref: `workflow-${row.id}`, original: row };
  });
}
function gatePremerge(gate, c, pr, now) {
  const b = gate.evidence_readiness?.binding;
  if (!b || b.repository !== c.repository || b.pr !== c.pullRequest || b.head_sha !== c.binding.headSha || b.base_ref !== c.baseRef || b.merge_sha !== pr.merge_commit_sha
    || gate.execution_merge_sha !== pr.merge_commit_sha) fail("gate_binding_mismatch");
  const started = Date.parse(gate.gate_observation?.gate_started_at), finished = Date.parse(gate.gate_observation?.gate_finished_at), merged = Date.parse(pr.merged_at);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || !Number.isFinite(merged) || started > finished || finished > now) fail("gate_original_invalid");
  if (finished > merged) fail("gate_after_merge_not_premerge");
  if (gate.result_scope !== "gate-evaluation" || gate.pass !== true || !["PASS", "PASS_ESCALATED", "PASS_OWNER_AUTHORIZED"].includes(gate.verdict) || gate.execution_exit_code !== 0) fail("gate_not_accepted");
  const observations = gate.execution_observations;
  if (gate.execution_observations_schema !== "ai-gate-observations/1" || !Array.isArray(observations)) fail("gate_original_invalid");
  for (const action of ["gate-evaluate", "actual-merge", "post-merge-ci"]) {
    const selected = observations.filter(x => x.action === action);
    if (selected.length !== 1 || selected[0].result !== "ok" || selected[0].head_sha !== c.binding.headSha || selected[0].source_sha !== c.binding.headSha) fail("gate_required_result_missing");
    if (action === "actual-merge" && selected[0].reason_code !== "merge-observed") fail("gate_after_merge_not_premerge");
  }
}

function repositoryReviewOriginal(original, c, pr, now) {
  const r = c.repositoryReview, merged = Date.parse(pr.merged_at);
  if (!original || original.id !== r.commentId || original.user?.login !== r.author
    || original.issue_url !== `https://api.github.com/repos/${c.repository}/issues/${c.pullRequest}`) fail("review_original_mismatch");
  const body = original.body;
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > 256 * 1024 || !body.includes(c.binding.headSha)
    || createHash("sha256").update(body, "utf8").digest("hex") !== r.bodySha256) fail("review_original_mismatch");
  const created = Date.parse(original.created_at), updated = Date.parse(original.updated_at);
  if (![created, updated, merged, now].every(Number.isFinite) || created > updated || updated > merged || merged > now) fail("review_not_premerge");
  // Never export the review body/paths or infer a verdict from its text.
  return { id: original.id, author: r.author, bodySha256: r.bodySha256, createdAt: original.created_at, updatedAt: original.updated_at };
}

/** One explicitly selected owner stage. The complete original requirements are
 * caller/owner policy, not discovered from whichever checks happen to be green.
 * readGitHub/readGate are trusted IO seams for tests/hosts, never payload code.
 */
export async function prepareCodeOwnerReadback(value, { readGitHub = githubOriginal, readGate = readSubagentFile, now = Date.now } = {}) {
  let contract, observation;
  try { contract = snapshotCodeOwnerContract(value); }
  catch { return { observation: { schema: 1, decision: "reconcile_required", reasonCode: "contract_invalid", binding: null, authorization: "none", readOnly: true } }; }
  try {
    const c = contract, pr = await readGitHub("pr", c), merge = pr.merge_commit_sha;
    if (pr.number !== c.pullRequest || pr.head?.sha !== c.binding.headSha || pr.base?.repo?.full_name !== c.repository || pr.base?.ref !== c.baseRef) fail("pr_binding_mismatch");
    if (pr.merged !== true || !sha(merge)) fail("pr_not_merged");
    const [checks, workflows, ancestry, acceptanceOriginal] = await Promise.all([
      readGitHub("checks", c, merge), readGitHub("workflows", c, merge), readGitHub("ancestry", c, merge),
      c.repositoryReview ? readGitHub("review", c, merge) : readGate(c.gateReportFile),
    ]);
    if (ancestry.base_commit?.sha !== merge || !["identical", "ahead"].includes(ancestry.status)) fail("merge_not_in_base");
    const required = [...selectChecks(checks, c), ...selectWorkflows(workflows, c, merge)];
    const originalFingerprint = digest(required);
    const current = await readGitHub("pr", c);
    if (current.number !== pr.number || current.head?.sha !== pr.head?.sha || current.base?.ref !== pr.base?.ref || current.base?.repo?.full_name !== pr.base?.repo?.full_name
      || current.merged !== true || current.merge_commit_sha !== merge || current.merged_at !== pr.merged_at) fail("pr_changed_during_readback");
    const [lastChecks, lastWorkflows] = await Promise.all([readGitHub("checks", c, merge), readGitHub("workflows", c, merge)]);
    const finalRequired = [...selectChecks(lastChecks, c), ...selectWorkflows(lastWorkflows, c, merge)];
    if (originalFingerprint !== digest(finalRequired)) fail("required_evidence_changed_during_readback");
    const time = now();
    if (c.repositoryReview) {
      const original = repositoryReviewOriginal(acceptanceOriginal, c, pr, time);
      const currentReview = repositoryReviewOriginal(await readGitHub("review", c, merge), c, pr, time);
      if (digest(original) !== digest(currentReview)) fail("review_changed_during_readback");
      required.push({ kind: "readback", ref: `review-comment-${original.id}`, original });
    } else {
      const gate = parseOriginalGate(acceptanceOriginal); gatePremerge(gate, c, pr, time);
      required.push({ kind: "readback", ref: "gate-original", original: gate });
    }
    required.push({ kind: "merge", ref: `merge-${merge}`, original: pr });
    const observedAt = new Date(time).toISOString(), freshUntil = new Date(time + 30_000).toISOString();
    const readback = { binding: c.binding, sourceKind: "code", sourceRef: `github-pr-${c.pullRequest}`, disposition: "accepted", observedAt, freshUntil,
      requiredEvidence: required.map((r, i) => ({ evidenceId: `original-${i}`, kind: r.kind, sourceRef: r.ref, claims: ["source-stage-original"] })),
      evidence: required.map((r, i) => ({ binding: c.binding, record: { evidence_id: `original-${i}`, run_id: c.binding.runId, kind: r.kind, state: "validated", source_ref: r.ref, source_sha: c.binding.headSha,
        content_digest: digest(r.original), claims: ["source-stage-original"], observed_at: observedAt, fresh_until: freshUntil, counterevidence_refs: [], redaction_profile: "metadata-only" } })),
      requiredEffects: [{ binding: c.binding, effectRef: `merge-${merge}`, outcome: "settled", disposition: "accepted" }],
    };
    observation = consumePiOwnerResult(c.binding, readback, time);
    return Object.freeze({ readback, observation: Object.freeze({ schema: 1, ...observation, originals: required.map(r => r.ref), mergeSha: merge, scope: "source-shared-delivery-only", taskPermission: "unchanged" }) });
  } catch (error) {
    return Object.freeze({ observation: Object.freeze({ schema: 1, binding: contract.binding, decision: "reconcile_required", outcome: "unknown", reasonCode: error instanceof CodeOwnerObservationError ? error.reason : "owner_original_unavailable", authorization: "none", readOnly: true }) });
  }
}

/** Original terminal/CLI contract; preparation retains the genuine readback for
 * the explicit host tool without reconstructing evidence from a result flag. */
export async function observeCodeOwner(value, options) {
  return (await prepareCodeOwnerReadback(value, options)).observation;
}

export async function recordCodeOwnerObservation(view, store) {
  if (!view.binding) return false;
  try {
    const binding = snapshotPiWorkBinding(view.binding);
    const event = { run_id: binding.runId, step_id: `${binding.runId}_${randomUUID()}`, ts: Date.now(),
      session_id: digest(binding.sessionId), source_sha: binding.headSha, trace_id: digest(binding.workRef), component: "pi",
      action: "pi:work:code-owner-result", result: view.decision === "deliverable" ? "ok" : "unknown",
      target_class: "source-stage-observation", policy_version: "pi-code-owner-1", reason_code: view.reasonCode,
      artifact_refs: [{ type: "work-stage", ref: binding.stageId }],
    };
    await store.append(event);
    // EventStore append is fail-open. Absence of a thrown error is not a durable
    // write receipt; confirm only this exact new safe event through its reader.
    const recorded = await store.readRun(binding.runId);
    return recorded.some(row => row.step_id === event.step_id && row.source_sha === event.source_sha && row.action === event.action && row.result === event.result);
  } catch { return false; }
}

if (isMain(import.meta.url)) {
  const arg = process.argv.slice(2);
  if (![1, 2].includes(arg.length) || !arg[0].startsWith("--contract=") || (arg.length === 2 && arg[1] !== "--record")) {
    console.error("usage: --contract=<explicit private owner contract file> [--record]"); process.exitCode = 2;
  } else try {
    const contract = JSON.parse((await readSubagentFile(arg[0].slice(11))).toString("utf8"));
    const result = await observeCodeOwner(contract);
    const recorded = arg.length === 2 ? await recordCodeOwnerObservation(result, new EventStore()) : undefined;
    console.log(JSON.stringify({ ...result, ...(recorded === undefined ? {} : { observationRecorded: recorded }) }));
  }
  catch { console.log(JSON.stringify({ decision: "reconcile_required", outcome: "unknown", reasonCode: "contract_original_unavailable", authorization: "none", readOnly: true })); process.exitCode = 1; }
}
