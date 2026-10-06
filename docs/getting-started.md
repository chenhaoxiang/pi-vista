# Getting started with pi-vista

## 1. Install the Phase 1 package

```bash
npm install @pi-vista/core
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
- [workspace-guard](adapters/workspace-guard.md)
- [ai-gate](adapters/ai-gate.md)

## 4. Offline Phase 2 observation

This checkout implements `@pi-vista/cli` with the `vista` bin and a public
read-only API. Build a checkout and run its entrypoint directly:

```bash
npm run build
node packages/cli/dist/bin.js history --base-dir ./synthetic-store
node packages/cli/dist/bin.js history run-example --base-dir ./synthetic-store --json
node packages/cli/dist/bin.js inspect run-example --step run-example_s0 --base-dir ./synthetic-store
node packages/cli/dist/bin.js compare run-example run-other --base-dir ./synthetic-store
node packages/cli/dist/bin.js receipts run-example --base-dir ./synthetic-store --json
```

The installed package's bin name is `vista`. Source availability does not claim
registry publication, clean consumer installation, or deployment. Use a local
synthetic store for tests; omitting `--base-dir` reads core's default store.

These commands observe recorded data only. Core readers can silently omit
missing, unreadable, corrupt or invalid records; empty output is not a PASS.
Receipts are opaque refs with owner-claimed metadata, never fetched content,
independent verification, or merge/execution permission. See the maintained
[CLI guide](cli.md) for strict parsing, closed privacy projection, deterministic
ordering, exact bounds, API and exit codes.

## 5. Planned Phase 3 promotion

Promotion to Hindsight is future work. These commands are design notes,
not implemented by the observation CLI:

```bash
vista promote <run_id> --dry-run   # planned preview
vista promote <run_id> --confirm   # planned Hindsight write
```
