# @pi-vista/cli

Offline, read-only Phase 2 observation of local pi-vista records. The package
provides the `vista` bin and public `parseArgs`, `observe`, and `runCli` APIs.
Runtime dependencies are public `@pi-vista/core`, `@pi-vista/protocol`, and Node
built-ins only. Node.js 20+ is required.

```bash
vista history [run_id] --base-dir ./synthetic-store
vista inspect run-example --step run-example_s0 --base-dir ./synthetic-store
vista compare run-example run-other --base-dir ./synthetic-store --json
vista receipts run-example --base-dir ./synthetic-store
vista --help
```

From a checkout, build with `npm run build` and use
`node packages/cli/dist/bin.js` instead of `vista`. This implementation does not
claim registry publication or clean consumer-install verification.

All output is **recorded-only**. Core readers are best-effort and can omit
missing, unreadable, corrupt or invalid data. Empty output/exit 0 is not an audit
PASS. Receipts contain opaque references and **owner-claimed** metadata only;
`verified`, `ok`, stats, and checkpoint resumability never grant authorization.
No artifact bodies, URLs, hooks, model calls, shell commands, replay, promotion,
Hindsight writes, or network access are performed.

`--json` selects a closed sanitized view; `--limit` is 1–100 (default 50).
Nested lists and stdout bytes are also bounded. Errors are fixed, without paths,
raw arguments, secrets or stacks. See the maintained
[CLI guide](https://github.com/chenhaoxiang/pi-vista/blob/main/docs/cli.md) for the
complete display, privacy, ordering, limits, best-effort, API and exit contract.
