import { CheckpointStore, EventStore } from "@pi-vista/core";
import type { VistaEvent } from "@pi-vista/protocol";
import {
  CliError, compareText, COUNT_FIELDS, DEFAULT_LIMIT, MAX_OUTPUT_BYTES, NESTED_LIMIT, page,
  type CountEntry, type CountField, type Difference, type EventView, type ObservationContract,
  type ObservationRequest, type ObservationView, type ReadCounts, type ReceiptObservation, type ReceiptView,
} from "./contract.js";
import { validateRequest } from "./parse.js";
import { displayIdentifier, displayLabel, displayRef, isBoundStep, isCliIdentifier, WITHHELD } from "./safety.js";
import { compareEvents, projectCheckpoint, projectEvent, projectReceiptObservation } from "./views.js";

const CONTRACT: ObservationContract = {
  observation: "recorded-only",
  storage: "core-best-effort; missing, unreadable, corrupt or invalid records may be omitted",
  independent_verification: "not-performed",
  authorization: "none",
  version_compatibility: "not-assessed",
};

interface ReadEvents {
  pairs: { stored: VistaEvent; view: EventView }[];
  events: EventView[];
  reads: ReadCounts;
}

async function readEvents(store: EventStore, runId: string, stepId?: string): Promise<ReadEvents> {
  const returned = (await store.readRun(runId)).filter((event) => stepId === undefined || event.step_id === stepId);
  const pairs: ReadEvents["pairs"] = [];
  for (const stored of returned) {
    const view = projectEvent(stored);
    if (view !== undefined) pairs.push({ stored, view });
  }
  pairs.sort((a, b) => compareEvents(a.view, b.view));
  return {
    pairs, events: pairs.map(({ view }) => view),
    reads: { core_returned_events: returned.length, projected_events: pairs.length, identity_withheld_events: returned.length - pairs.length },
  };
}

function compareLabels(a: string | null, b: string | null): number {
  return a === null ? (b === null ? 0 : -1) : b === null ? 1 : compareText(a, b);
}

function counts(events: readonly EventView[], field: CountField): CountEntry[] {
  const result = new Map<string | null, number>();
  for (const event of events) {
    const label = event[field] ?? null;
    result.set(label, (result.get(label) ?? 0) + 1);
  }
  return [...result].sort(([a], [b]) => compareLabels(a, b)).map(([label, count]) => ({ label, count }));
}

function differences(a: readonly EventView[], b: readonly EventView[], field: CountField): Difference[] {
  const left = new Map(counts(a, field).map(({ label, count }) => [label, count]));
  const right = new Map(counts(b, field).map(({ label, count }) => [label, count]));
  return [...new Set([...left.keys(), ...right.keys()])].sort(compareLabels)
    .map((label) => ({ label, a: left.get(label) ?? 0, b: right.get(label) ?? 0, delta_b_minus_a: (right.get(label) ?? 0) - (left.get(label) ?? 0) }))
    .filter(({ a: leftCount, b: rightCount }) => leftCount !== rightCount);
}

function receipts(pairs: ReadEvents["pairs"]): { items: ReceiptView[]; withheld: number } {
  const groups = new Map<string, { type: string; ref: string; sha?: string; occurrences: number; observations: Map<string, ReceiptObservation> }>();
  let withheld = 0;
  for (const { stored, view } of pairs) {
    for (const artifact of stored.artifact_refs ?? []) {
      const type = displayLabel(artifact.type, "type");
      const ref = displayRef(artifact.ref);
      const sha = artifact.sha !== undefined ? displayIdentifier(artifact.sha) : undefined;
      if (type === WITHHELD || ref === undefined || sha === WITHHELD) {
        withheld += 1;
        continue;
      }
      const key = JSON.stringify([type, ref, sha ?? null]);
      const group = groups.get(key) ?? { type, ref, ...(sha !== undefined ? { sha } : {}), occurrences: 0, observations: new Map<string, ReceiptObservation>() };
      group.occurrences += 1;
      const observation = projectReceiptObservation(view, artifact);
      group.observations.set(JSON.stringify(observation), observation);
      groups.set(key, group);
    }
  }
  const items = [...groups.values()].sort((a, b) => compareText(a.type, b.type) || compareText(a.ref, b.ref) || compareText(a.sha ?? "", b.sha ?? ""))
    .map(({ type, ref, sha, occurrences, observations }): ReceiptView => ({
      type, ref, ...(sha !== undefined ? { sha } : {}), occurrences,
      observations: page([...observations.values()].sort((a, b) => compareEvents(a.event, b.event) || compareText(JSON.stringify(a), JSON.stringify(b))), NESTED_LIMIT),
    }));
  return { items, withheld };
}

async function readObservation(request: ObservationRequest): Promise<ObservationView> {
  const limit = request.limit ?? DEFAULT_LIMIT;
  const events = new EventStore(request.baseDir !== undefined ? { baseDir: request.baseDir } : {});
  const checkpoints = new CheckpointStore(request.baseDir !== undefined ? { baseDir: request.baseDir } : {});
  if (request.command === "history" && request.runId === undefined) {
    const returned = await events.listRuns();
    const safe = returned.filter(isCliIdentifier).sort(compareText);
    return { ...CONTRACT, command: "history", mode: "inventory", runs: page(safe, limit), withheld_run_ids: returned.length - safe.length };
  }
  if (request.command === "compare") {
    const a = await readEvents(events, request.runIdA);
    const b = await readEvents(events, request.runIdB);
    const entries = COUNT_FIELDS.map((field) => [field, page(differences(a.events, b.events, field), limit)] as const);
    return { ...CONTRACT, command: "compare", run_id_a: request.runIdA, run_id_b: request.runIdB, reads_a: a.reads, reads_b: b.reads, differences: Object.fromEntries(entries) as Record<CountField, ReturnType<typeof page<Difference>>> };
  }
  const runId = request.runId!;
  const read = await readEvents(events, runId, request.command === "inspect" ? request.stepId : undefined);
  if (request.command === "history") {
    return { ...CONTRACT, command: "history", mode: "timeline", run_id: runId, reads: read.reads, events: page(read.events, limit) };
  }
  if (request.command === "receipts") {
    // Deduplicate before applying the top-level limit so counts describe all
    // projected, core-returned references, not only the displayed event page.
    const result = receipts(read.pairs);
    return { ...CONTRACT, command: "receipts", run_id: runId, reads: read.reads, metadata: "owner-claimed; not independently verified; not authorization", withheld_refs: result.withheld, receipts: page(result.items, limit) };
  }
  const stepIds = request.stepId !== undefined ? [request.stepId] : await checkpoints.listCheckpoints(runId);
  const safeStepIds = stepIds.filter((stepId) => isBoundStep(runId, stepId)).sort(compareText);
  const loaded = [];
  for (const stepId of safeStepIds) {
    const checkpoint = await checkpoints.load(runId, stepId);
    if (checkpoint !== null) loaded.push(projectCheckpoint(checkpoint));
  }
  const entries = COUNT_FIELDS.map((field) => [field, page(counts(read.events, field), limit)] as const);
  return {
    ...CONTRACT, command: "inspect", run_id: runId, ...(request.stepId !== undefined ? { step_id: request.stepId } : {}),
    reads: read.reads, recorded_counts: Object.fromEntries(entries) as Record<CountField, ReturnType<typeof page<CountEntry>>>,
    events: page(read.events, limit), checkpoints: page(loaded, limit), withheld_checkpoint_ids: stepIds.length - safeStepIds.length,
  };
}

/** Public read-only API. No append/save, directory creation, or artifact resolution. */
export async function observe(input: ObservationRequest): Promise<ObservationView> {
  const request = validateRequest(input);
  try {
    const view = await readObservation(request);
    if (Buffer.byteLength(JSON.stringify(view), "utf8") > MAX_OUTPUT_BYTES) throw new CliError("output");
    return view;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("observation");
  }
}
