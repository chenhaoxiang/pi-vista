import { requireCanary } from "./pi-agent-canary-support.mjs";

const notifications = new Set(["session_start", "session_shutdown", "agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end"]);
const commands = new Set(["vista-status", "vista-preview", "vista-adopt", "vista-verify"]);
/** Host-owned PUBLIC ResourceLoader/Extension data contract. No package resolver, file/module or ancestor discovery. */
export function explicitCanaryResources(sdk, factory, systemPrompt) {
  let loaded;
  return {
    getExtensions() { requireCanary(loaded !== undefined); return loaded; },
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt, getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources(paths) { requireCanary(!Object.values(paths).some(value => value?.length > 0)); },
    async reload() {
      const source = "<inline:pi-vista-canary>";
      const extension = { path: source, resolvedPath: source, sourceInfo: { path: source, source: "inline", scope: "temporary", origin: "top-level" },
        handlers: new Map(), tools: new Map(), messageRenderers: new Map(), entryRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map() };
      const api = {
        on(name, handler) {
          requireCanary(notifications.has(name) && typeof handler === "function");
          const list = extension.handlers.get(name) ?? []; list.push(handler); extension.handlers.set(name, list);
          return () => { const index = list.indexOf(handler); if (index >= 0) list.splice(index, 1); };
        },
        registerCommand(name, definition) {
          requireCanary(commands.has(name) && !extension.commands.has(name));
          extension.commands.set(name, { ...definition, name, sourceInfo: extension.sourceInfo });
        },
      };
      const runtime = sdk.createExtensionRuntime(); await factory(api);
      loaded = { extensions: [extension], errors: [], warnings: [], runtime };
    },
  };
}
