# Getting started with pi-vista

## 1. Install the Phase 1 package

```bash
npm install @pi-vista/core @pi-vista/adapter-pi
```

`@pi-vista/core` declares the matching published `@pi-vista/protocol` package
as a runtime dependency, so npm installs it automatically. For an adapter that
uses only the TypeScript interfaces, install the protocol package directly:

```bash
npm install @pi-vista/protocol
```

The published packages include their compiled `dist` entry points; no checkout
build step is required after installation.

## 2. Set VISTA_RUN_ID in your Pi session

pi-vista uses a `run_id` to tie all events from one task together.
The Pi adapter sets this automatically. For manual use:

```bash
export VISTA_RUN_ID=$(node -e "console.log(crypto.randomUUID())")
```

## 3. Add emit calls to your adapters

See the adapter docs:
- [Pi run context](adapters/pi.md)
- [workspace-guard](adapters/workspace-guard.md)
- [ai-gate](adapters/ai-gate.md)

A Pi private extension calls `@pi-vista/adapter-pi` explicitly. The public
package does not install or patch Pi, and it does not own execution, fallback,
watchdog, permission, or model-routing decisions.

## 4. Planned Phase 2 tools

Phase 1 does not ship a `vista` CLI. The following commands describe the
planned Phase 2 interface; they are not runnable in this release:

```bash
vista history <run_id>
vista inspect <run_id>
```

## 5. Planned Phase 3 promotion

Promotion to Hindsight is also future work. These commands are design notes,
not an available Phase 1 CLI:

```bash
vista promote <run_id> --dry-run   # planned preview
vista promote <run_id> --confirm   # planned Hindsight write
```
