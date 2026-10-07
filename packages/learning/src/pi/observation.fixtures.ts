import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { VistaCheckpoint, VistaEvent } from "@pi-vista/core";
import { createPiObservation, type PiObservationConfig, type PiNotification, type PiTask, type PiUIContext } from "@pi-vista/learning/pi";
import { EXPECTED } from "../learning.fixtures.js";

export const TASK: PiTask = { repo: EXPECTED.repo, source_sha: EXPECTED.source_sha, policy_version: EXPECTED.policy_version,
  env_fingerprint: EXPECTED.env_fingerprint, task_type: "metadata-update", task_goal: "bounded metadata validation", bank: "fixture-bank", session_alias: "session-fixture" };
export function mockHost() {
  const hooks = new Map<PiNotification, (event: unknown, ctx: PiUIContext) => undefined>();
  const commands = new Map<string, { description: string; handler: (args: string, ctx: PiUIContext) => Promise<void> }>();
  const messages: string[] = [];
  const ctx: PiUIContext = { hasUI: true, ui: { notify: value => { messages.push(value); } } };
  return { hooks, commands, messages, ctx, api: {
    on(name: PiNotification, handler: (event: unknown, ctx: PiUIContext) => undefined) {
      assert.equal(hooks.has(name), false); hooks.set(name, handler); return () => { hooks.delete(name); };
    },
    registerCommand(name: string, command: { description: string; handler: (args: string, ctx: PiUIContext) => Promise<void> }) {
      assert.equal(commands.has(name), false); commands.set(name, command);
    },
  }, fire(name: PiNotification, event: unknown = {}) { assert.equal(hooks.get(name)!(event, ctx), undefined, "all notifications return undefined synchronously"); } };
}
export function harness(options: Partial<PiObservationConfig> = {}) {
  const events: VistaEvent[] = []; const checkpoints: VistaCheckpoint[] = []; let currentTask: unknown = { ...TASK }; let taskCalls = 0;
  const addon = createPiObservation({ resolve_task: async () => { taskCalls++; return currentTask; }, now: () => 20_000,
    tools: [{ native_name: "read", classification: "metadata-reader" }, { native_name: "bash", classification: "host-shell" }],
    events: { append: async e => { events.push(e); } }, checkpoints: { save: async cp => { checkpoints.push(cp); } }, timeout_ms: 100, ...options });
  const host = mockHost(); addon.extension(host.api);
  return { ...addon, ...host, events, checkpoints, taskCalls: () => taskCalls, setTask: (input: unknown) => { currentTask = input; } };
}
export async function idle(controller: { status(): { pending_work: number } }) {
  for (let i = 0; i < 200; i++) { if (controller.status().pending_work === 0) return; await delay(2); }
  assert.fail("bounded fixture work must finish");
}
export async function start(h: ReturnType<typeof harness>) { h.fire("session_start"); h.fire("agent_start"); await idle(h.controller); }
export const startCall = (id: string, name = "read") => ({ toolCallId: id, toolName: name, args: { secret: "raw-argument-canary" } });
export const endCall = (id: string, error: unknown = false) => ({ toolCallId: id, toolName: "read", isError: error, result: { content: "raw-result-canary" } });
export { delay };
