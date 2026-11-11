import { snapshotCodeOwnerContract, githubOriginal, prepareCodeOwnerReadback } from "./pi-code-owner.mjs";
import { codeProgressRow } from "./pi-code-progress.mjs";
import { readSubagentFile } from "./pi-subagent-owner.mjs";

const fingerprint = value => JSON.stringify(value);
function reject(reason) { throw Object.assign(Error("code-source-unavailable"), { reason }); }
function prMatches(pr, c) {
  return pr?.number === c.pullRequest && pr.head?.sha === c.binding.headSha && pr.base?.repo?.full_name === c.repository && pr.base?.ref === c.baseRef;
}
function collection(value, key) {
  if (!value || !Array.isArray(value[key]) || value.total_count !== value[key].length || value[key].length > 100) reject("source_original_unavailable");
  return value[key];
}
function latest(rows) {
  if (rows.some(row => !Number.isSafeInteger(row.id) || row.id < 1)) reject("source_original_unavailable");
  return [...rows].sort((a, b) => b.id - a.id)[0] ?? null;
}
function checks(value, c) {
  const rows = collection(value, "check_runs");
  return c.headChecks.map(r => latest(rows.filter(row => row.name === r.name && row.app?.id === r.appId && row.head_sha === c.binding.headSha)));
}
function workflows(value, c, merge) {
  const rows = collection(value, "workflow_runs");
  return c.mergeWorkflows.map(name => latest(rows.filter(row => row.name === name && row.head_sha === merge && row.event === "push"
    && row.head_branch === c.baseRef && row.repository?.full_name === c.repository)));
}
function state(rows) {
  for (const row of rows) {
    if (row === null) continue;
    if (row.status === "completed") {
      if (!["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required", "stale", "startup_failure"].includes(row.conclusion)) reject("source_original_unavailable");
    } else if (!["queued", "in_progress", "requested", "waiting", "pending"].includes(row.status) || row.conclusion != null) reject("source_original_unavailable");
  }
  if (rows.some(row => row && row.status === "completed" && row.conclusion !== "success")) return "failed";
  if (rows.some(row => row && ["queued", "in_progress", "requested", "waiting", "pending"].includes(row.status))) return "pending";
  if (rows.some(row => row === null)) return "missing";
  if (rows.every(row => row.status === "completed" && row.conclusion === "success")) return "complete";
  reject("source_original_unavailable");
}
function prIdentity(pr) {
  return [pr?.number, pr?.head?.sha, pr?.base?.repo?.full_name, pr?.base?.ref, pr?.state, pr?.draft, pr?.merged, pr?.merged_at, pr?.merge_commit_sha];
}

/** One explicit public-source bracket. Raw originals and the genuine readback
 * stay in this trusted host invocation; no DTO flags are converted to evidence.
 * At most8 GETs for Gate owners or10 for the explicit independent review-original
 * adoption; no retry/poll and no Gate is fabricated for an independent owner. */
export async function readCodeStage(value, { readGitHub = githubOriginal, readGate = readSubagentFile, now = Date.now, signal } = {}) {
  let c, publicSource = false;
  try {
    c = snapshotCodeOwnerContract(value);
    // Validate safe export fields before any source IO, without publishing a row.
    codeProgressRow(c, "source_original_unavailable", 0);
    const get = async (kind, merge) => {
      signal?.throwIfAborted();
      const original = await readGitHub(kind, c, merge, { signal });
      // Snapshot the trusted JSON reader result so a later read cannot mutate it.
      return JSON.parse(JSON.stringify(original));
    };
    const repository = await get("repository");
    if (repository?.full_name !== c.repository || repository.private !== false || repository.visibility !== "public") reject("public_source_unconfirmed");
    publicSource = true;
    const pr = await get("pr");
    if (!prMatches(pr, c)) reject("source_binding_mismatch");
    if (!["open", "closed"].includes(pr.state) || typeof pr.merged !== "boolean" || typeof pr.draft !== "boolean") reject("source_original_unavailable");
    if (!pr.merged && pr.state !== "open") reject("source_original_unavailable");
    const merge = pr.merged ? pr.merge_commit_sha : undefined;
    if (pr.merged && !/^[a-f0-9]{40}$/u.test(merge ?? "")) reject("source_binding_mismatch");
    const initialChecks = await get("checks", merge);
    const selectedChecks = checks(initialChecks, c), checksFingerprint = fingerprint(selectedChecks);
    let initialWorkflows, selectedWorkflows, workflowsFingerprint, ancestry, initialReview;
    if (pr.merged) {
      // Wait for both owned reads even on failure; no detached retry is started.
      const read = await Promise.allSettled([get("workflows", merge), get("ancestry", merge), ...(c.repositoryReview ? [get("review", merge)] : [])]);
      if (read.some(row => row.status === "rejected")) reject("source_original_unavailable");
      initialWorkflows = read[0].value; ancestry = read[1].value; initialReview = read[2]?.value;
      selectedWorkflows = workflows(initialWorkflows, c, merge); workflowsFingerprint = fingerprint(selectedWorkflows);
      if (ancestry?.base_commit?.sha !== merge || !["identical", "ahead"].includes(ancestry.status)) reject("source_binding_mismatch");
    }
    const finalPr = await get("pr", merge);
    if (fingerprint(prIdentity(finalPr)) !== fingerprint(prIdentity(pr))) reject("source_binding_mismatch");
    const finalChecks = await get("checks", merge);
    if (fingerprint(checks(finalChecks, c)) !== checksFingerprint) reject("source_original_unavailable");
    let finalWorkflows;
    if (pr.merged) {
      finalWorkflows = await get("workflows", merge);
      if (fingerprint(workflows(finalWorkflows, c, merge)) !== workflowsFingerprint) reject("source_original_unavailable");
    }
    const row = reason => codeProgressRow(c, reason, now());
    if (pr.draft) return { progress: row("pr_not_ready") };
    const headState = state(selectedChecks);
    if (headState !== "complete") return { progress: row(`required_checks_${headState}`) };
    // A matching review hash is part of the original requirement, not generic CI success.
    if (c.headChecks.some((r, i) => r.reviewHash && !selectedChecks[i]?.output?.summary?.includes(r.reviewHash))) {
      return { progress: row("required_checks_missing") };
    }
    if (!pr.merged) return { progress: row("owner_delivery_pending") };
    const mergeState = state(selectedWorkflows);
    if (mergeState !== "complete") return { progress: row(`postmerge_workflows_${mergeState}`) };
    // The unchanged original verifier consumes these exact bracketed originals.
    // Its normal two-round read order is replayed from this invocation's values,
    // not from flags, review text, model output or a separately written receipt.
    const finalReview = c.repositoryReview ? await get("review", merge) : undefined;
    const originals = { pr: [pr, finalPr], checks: [initialChecks, finalChecks], workflows: [initialWorkflows, finalWorkflows], ancestry: [ancestry], review: [initialReview, finalReview] };
    const indexes = {};
    const prepared = await prepareCodeOwnerReadback(c, {
      now,
      readGate: async file => { signal?.throwIfAborted(); return readGate(file); },
      readGitHub: async kind => {
        const index = indexes[kind] ?? 0; indexes[kind] = index + 1;
        if (!originals[kind] || index >= originals[kind].length) reject("source_original_unavailable");
        return originals[kind][index];
      },
    });
    signal?.throwIfAborted();
    if (prepared.readback && prepared.observation.decision === "deliverable") return { progress: row("none"), readback: prepared.readback };
    return { progress: row(c.repositoryReview ? "source_original_unavailable" : "owner_gate_unavailable") };
  } catch (error) {
    // Unconfirmed/private repository names, paths and raw errors never escape.
    if (!c || !publicSource) return { progress: null, reasonCode: "source_original_unavailable" };
    const reason = error?.reason === "source_binding_mismatch" ? "source_binding_mismatch" : "source_original_unavailable";
    try { return { progress: codeProgressRow(c, reason, now()) }; }
    catch { return { progress: null, reasonCode: "source_original_unavailable" }; }
  }
}
