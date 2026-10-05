# Getting started with pi-vista

## 1. Install the core package

```bash
npm install @pi-vista/core
```

`@pi-vista/core` includes the runtime event emitter, redaction, and local
stores. Install `@pi-vista/protocol` separately only when an adapter needs the
TypeScript interfaces directly.

## 2. Set VISTA_RUN_ID in your Pi session

pi-vista uses a `run_id` to tie all events from one task together.
The Pi adapter sets this automatically. For manual use:

```bash
export VISTA_RUN_ID=$(node -e "console.log(crypto.randomUUID())")
```

## 3. Add emit calls to your adapters

See the adapter docs:
- [workspace-guard](adapters/workspace-guard.md)
- [ai-gate](adapters/ai-gate.md)

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
