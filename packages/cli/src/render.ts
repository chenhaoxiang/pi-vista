import { COUNT_FIELDS, type EventView, type ObservationView, type Page } from "./contract.js";

function pageHeading<T>(name: string, value: Page<T>): string {
  return `${name}: ${value.items.length}/${value.total} projected entries (${value.omitted} omitted by limit)`;
}

function eventLine(event: EventView): string {
  return `  ${event.ts} ${event.step_id} ${event.component} ${event.action} result=${event.result}` +
    ` reason=${event.reason_code ?? "(not recorded)"} source_sha=${event.source_sha ?? "(not recorded)"}` +
    ` vista_version=${event.vista_version ?? "(not recorded)"}`;
}

export function renderText(view: ObservationView): string {
  const lines = [
    `${view.command}: recorded-only observation`,
    `Storage: ${view.storage}. This is not an exhaustive audit.`,
    "Independent verification: not performed. Authorization: none. Version compatibility: not assessed.",
  ];
  if (view.command === "history" && view.mode === "inventory") {
    lines.push(pageHeading("Runs", view.runs), ...view.runs.items.map((run) => `  ${run}`), `Withheld run IDs: ${view.withheld_run_ids}`);
  } else if (view.command === "compare") {
    lines.push(`Run A: ${view.run_id_a} (${view.reads_a.projected_events} projected events)`, `Run B: ${view.run_id_b} (${view.reads_b.projected_events} projected events)`);
    lines.push(`Identity-withheld events: A=${view.reads_a.identity_withheld_events} B=${view.reads_b.identity_withheld_events}`);
    for (const field of COUNT_FIELDS) {
      lines.push(pageHeading(`${field} count differences`, view.differences[field]));
      for (const row of view.differences[field].items) lines.push(`  ${row.label ?? "(not recorded)"}: A=${row.a} B=${row.b} delta(B-A)=${row.delta_b_minus_a}`);
    }
    lines.push("Differences describe recorded counts, not quality or success rankings.");
  } else if (view.command === "receipts") {
    lines.push(`Run: ${view.run_id}`, `Metadata: ${view.metadata}. Artifact content is never resolved.`, pageHeading("Opaque references", view.receipts), `Withheld references: ${view.withheld_refs}`);
    lines.push(`Events: ${view.reads.projected_events} projected; ${view.reads.identity_withheld_events} identity-withheld`);
    for (const receipt of view.receipts.items) {
      lines.push(`  ${receipt.type} ref=${receipt.ref} sha=${receipt.sha ?? "(not recorded)"} occurrences=${receipt.occurrences}`);
      lines.push(`    ${pageHeading("Owner-claimed observations", receipt.observations)}`);
      for (const observation of receipt.observations.items) {
        lines.push(`    run=${observation.event.run_id} step=${observation.event.step_id} ts=${observation.event.ts} component=${observation.event.component} action=${observation.event.action} recorded_result=${observation.event.result} owner_claimed_verified=${observation.owner_claimed_verified ?? "(not recorded)"}`);
        lines.push(`    source_sha=${observation.event.source_sha ?? "(not recorded)"} vista_version=${observation.event.vista_version ?? "(not recorded)"}`);
        lines.push(`    ${pageHeading("Owner-claimed stats", observation.owner_claimed_stats)}; ${observation.withheld_stats} unsafe labels withheld`);
        for (const stat of observation.owner_claimed_stats.items) lines.push(`      ${stat.label}=${stat.value}`);
      }
    }
  } else {
    lines.push(`Run: ${view.run_id}`, `Events: ${view.reads.core_returned_events} core-returned; ${view.reads.projected_events} projected; ${view.reads.identity_withheld_events} identity-withheld`, pageHeading("Recorded timeline", view.events));
    lines.push(...view.events.items.map(eventLine));
    if (view.command === "inspect") {
      if (view.step_id !== undefined) lines.push(`Step filter: ${view.step_id}`);
      for (const field of COUNT_FIELDS) {
        lines.push(pageHeading(`${field} recorded counts`, view.recorded_counts[field]));
        for (const row of view.recorded_counts[field].items) lines.push(`  ${row.label ?? "(not recorded)"}: ${row.count}`);
      }
      lines.push(pageHeading("Run/step-bound checkpoints", view.checkpoints), `Withheld checkpoint IDs: ${view.withheld_checkpoint_ids}`);
      for (const checkpoint of view.checkpoints.items) {
        lines.push(`  ${checkpoint.step_id} ts=${checkpoint.ts} source_sha=${checkpoint.source_sha} env_fingerprint=${checkpoint.env_fingerprint} policy_version=${checkpoint.policy_version} owner_claimed_resumable=${checkpoint.owner_claimed_resumable}`);
        for (const field of ["completed_steps", "pending_steps", "check_fn_ids", "resume_requires"] as const) {
          lines.push(`    ${pageHeading(field, checkpoint[field])}: ${checkpoint[field].items.join(", ")}`);
        }
      }
      lines.push("Checkpoint narratives are omitted. No checkpoint authorizes resume or execution.");
    }
  }
  return `${lines.join("\n")}\n`;
}
