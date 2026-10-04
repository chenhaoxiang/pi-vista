# Getting started with pi-vista

## 1. Install the protocol package

```bash
npm install @pi-vista/protocol
```

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

## 4. Inspect a run

```bash
vista history <run_id>
vista inspect <run_id>
```

## 5. Promote a verified run to Hindsight

```bash
vista promote <run_id> --dry-run   # preview
vista promote <run_id> --confirm   # write to Hindsight
```
