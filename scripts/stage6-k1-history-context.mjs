import { createHash } from "node:crypto";
import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";
import { prepareHistoricalGuidance } from "@pi-vista/learning/guidance";
import { snapshotHistoryContext } from "./stage6-k1-admission.mjs";

const HISTORY_KEYS = ["bank", "document_id", "current_verification", "authorization", "executable", "content_digest", "idempotency_key", "document", "guidance"];
const DOCUMENT_KEYS = ["title", "content", "tags", "content_digest"];
const GUIDANCE_KEYS = ["schema", "purpose", "current_verification", "authorization", "executable", "experience"];
const CONTEXT_KEYS = ["mode", "authorization", "executable", "budget_unit", "content", "character_count", "max_characters", "item_count", "selected_ids", "omitted_ids", "provenance"];
const PROVENANCE_KEYS = ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint", "experience_id", "status", "scope", "observation_digests"];
const HEX64 = /^[a-f0-9]{64}$/u;
const SOURCE_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTEXT_HEADER = "authorization=none\nexecutable=false\nmode=local-script-step-context\nbudget=characters-not-tokens\n";
const reject = () => { throw Error("stage6-k1-history-context-refused"); };
const digest = value => createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function own(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) reject();
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) reject();
    result[key] = descriptor.value;
  }
  return result;
}
function list(value, max, min = 0) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Number.isSafeInteger(value.length) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) reject();
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) reject();
    result.push(descriptor.value);
  }
  return result;
}
function label(value) { if (typeof value !== "string" || !LABEL.test(value) || hasKnownCredential(value)) reject(); return value; }
function source(value) { if (typeof value !== "string" || !SOURCE_SHA.test(value)) reject(); return value; }
function sha(value) { if (typeof value !== "string" || !HEX64.test(value)) reject(); return value; }

function readHistory(value) {
  const history = own(value, HISTORY_KEYS);
  const document = own(history.document, DOCUMENT_KEYS);
  const guidance = own(history.guidance, GUIDANCE_KEYS);
  const tags = list(document.tags, 1, 1);
  let canonicalDocument;
  let normalizedExperience;
  try {
    canonicalDocument = prepareHistoricalGuidance(guidance.experience);
    normalizedExperience = JSON.parse(canonicalDocument.content).experience;
  } catch { reject(); }
  const experienceSource = source(normalizedExperience.source_sha);
  const experienceBinding = {
    repo: label(normalizedExperience.repo), source_sha: experienceSource,
    policy_version: label(normalizedExperience.policy_version), env_fingerprint: label(normalizedExperience.env_fingerprint),
  };
  if (history.current_verification !== "not-checked" || history.authorization !== "none" || history.executable !== false ||
      guidance.schema !== 1 || guidance.purpose !== "historical-guidance" || guidance.current_verification !== "not-checked" ||
      guidance.authorization !== "none" || guidance.executable !== false || typeof history.content_digest !== "string" ||
      !HEX64.test(history.content_digest) || document.content_digest !== history.content_digest || typeof document.content !== "string" ||
      document.content.length < 1 || document.content.length > 65_536 || digest(document.content) !== history.content_digest ||
      document.title !== canonicalDocument.title || document.content !== canonicalDocument.content || document.content_digest !== canonicalDocument.content_digest ||
      tags[0] !== canonicalDocument.tags[0] || typeof history.bank !== "string" || !LABEL.test(history.bank) || hasKnownCredential(history.bank) ||
      typeof history.document_id !== "string" || !/^vista-guidance-v1-[a-f0-9]{16}-[a-f0-9]{64}$/u.test(history.document_id) ||
      typeof history.idempotency_key !== "string" || !/^guidance-[a-f0-9]{64}$/u.test(history.idempotency_key)) reject();
  const expectedKey = `guidance-${digest(canonical({ bank: history.bank, document: canonicalDocument }))}`;
  if (history.idempotency_key !== expectedKey || history.document_id.slice(-64) !== digest(expectedKey)) reject();
  return { content_digest: history.content_digest, experience: normalizedExperience, experienceBinding, subject_source_sha: experienceSource };
}
function readProvenance(value) {
  const items = list(value, 16, 1);
  return items.map(item => {
    const p = own(item, PROVENANCE_KEYS);
    for (const key of ["run_id", "repo", "policy_version", "experience_id", "status", "scope"]) label(p[key]);
    source(p.source_sha); if (p.status !== "verified" && p.status !== "persisted") reject(); label(p.env_fingerprint);
    const observationDigests = list(p.observation_digests, 16, 1).map(sha);
    return { ...p, observation_digests: observationDigests };
  });
}
function readContext(value, history) {
  const context = own(value, CONTEXT_KEYS);
  if (context.mode !== "local-script-step-context" || context.authorization !== "none" || context.executable !== false || context.budget_unit !== "characters" ||
      typeof context.content !== "string" || context.content.length < 1 || !Number.isSafeInteger(context.character_count) ||
      context.character_count !== context.content.length || !Number.isSafeInteger(context.max_characters) || context.character_count > context.max_characters ||
      context.character_count > 8_192 || context.max_characters < 128 || context.max_characters > 16_384 || !Number.isSafeInteger(context.item_count) || context.item_count !== 1) reject();
  const selectedIds = list(context.selected_ids, 1, 1).map(label);
  const omittedIds = list(context.omitted_ids, 16, 0).map(label);
  if (omittedIds.length !== 0) reject();
  const provenance = readProvenance(context.provenance);
  if (provenance.length !== 1 || selectedIds[0] !== provenance[0].experience_id) reject();
  for (const key of ["repo", "source_sha", "policy_version", "env_fingerprint"]) {
    if (provenance[0][key] !== history.experienceBinding[key]) reject();
  }
  const expectedContent = `${CONTEXT_HEADER}${canonical({ authorization: "none", executable: false, provenance: provenance[0], script: history.experience.script, steps: history.experience.steps })}\n`;
  if (context.content !== expectedContent) reject();
  const provenanceDigests = provenance.flatMap(item => item.observation_digests);
  if (provenanceDigests.length < 1 || provenanceDigests.length > 16) reject();
  return { context, provenanceDigests };
}

/**
 * Convert trusted-host public GuidanceReadback + LocalCompiledContext into the
 * existing stage6-history-context/1 DTO consumed directly by admitK1.
 * The trusted host supplies already-read history and compiled context. Raw
 * content is used for canonical association and digest calculation only; the
 * bridge does not read a store/bank, restore current proof or create permission.
 * Historical, reimported LOCAL and future window run IDs remain independent;
 * none of the IDs, paths, raw text or budget fields leave this boundary.
 */
export function buildK1HistoryContext(input) {
  try {
    const value = own(input, ["history", "context"]);
    const history = readHistory(value.history);
    const { context, provenanceDigests } = readContext(value.context, history);
    return snapshotHistoryContext({
      schema: "stage6-history-context/1",
      purpose: "historical-guidance",
      current_verification: "not-checked",
      authorization: "none",
      executable: false,
      content_digest: history.content_digest,
      subject_source_sha: history.subject_source_sha,
      context_digest: digest(context.content),
      character_count: context.character_count,
      provenance_digests: provenanceDigests,
    });
  } catch { throw Error("stage6-k1-history-context-refused"); }
}
