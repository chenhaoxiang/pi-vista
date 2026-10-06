---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-10-06
ssot: true
---

# Offline observation CLI

`@pi-vista/cli` implements the bounded Phase 2 observation slice: `history`,
`inspect`, `compare`, and `receipts`. It is **read-only and offline**, not a
verifier, gate, auditor, replay engine, or promotion tool. Availability in this
checkout does not imply registry publication or production acceptance.

## Run it

Node.js 20 or newer is required. From a built checkout:

```bash
npm run build
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js history --base-dir ./synthetic-store --json
```

The package's `bin` entry is named `vista`; an installed package exposes the
same commands as `vista`. The examples below use that name. Never use real
session logs as test fixtures. Tests create disposable synthetic stores under
this checkout's `tmp/` and remove only their own directories.

```bash
vista history --base-dir ./synthetic-store
vista history run-example --base-dir ./synthetic-store --json
vista inspect run-example --step run-example_s0 --base-dir ./synthetic-store
vista compare run-example run-other --base-dir ./synthetic-store --json
vista receipts run-example --base-dir ./synthetic-store
```

## Commands and ordering

| Command | Recorded view |
| --- | --- |
| `history [run_id]` | Without an ID, sorted safe run-directory names, not proof of valid events. With an ID, the recorded event timeline. |
| `inspect <run_id> [--step <step_id>]` | Event timeline, recorded component/result/reason/source-SHA counts, and checkpoints returned by the public core readers. A step restricts both events and checkpoints. |
| `compare <run_id_a> <run_id_b>` | Only unequal recorded component/result/reason/source-SHA **counts**, with A, B, and `delta_b_minus_a`. There is no winner, success ranking, SHA verification, or promotion inference. |
| `receipts <run_id>` | Deduplicated opaque references, occurrence counts, and bounded event provenance plus **owner-claimed** metadata. Artifact content is never opened or fetched. |

Ordering uses code-unit comparison, not the host locale. Events sort by numeric
`ts`, then the fixed projected-field JSON representation for ties; identical
projected events are indistinguishable. Checkpoints sort lexicographically by
step ID, not timestamp. Count labels sort with `null` (not recorded) first.
Receipt identity is the tuple `(type, ref, sha)`, distinguishing an absent SHA
from a recorded one. References sort by type, ref, then SHA. Identical projected
receipt observations are deduplicated; conflicting `verified` flags remain
separate observations. `occurrences` counts all retained reference occurrences.
Provenance sorts by event order and then projected metadata.

All counts describe **core-returned, CLI-projected records**, not the full raw
store. Limits are applied after counting and deduplication, not to an arbitrary
prefix of the event file. Missing reason/SHA fields have a `null` count label;
redacted labels can collapse different sensitive values into `[REDACTED]`.
For step-filtered inspection, read counts describe only events matching that
step, not every event in the run.

## Arguments and exact bounds

Observation options can precede or follow the command:

- `--base-dir <directory>`: read this local core store. Relative directories are
  resolved by core. When omitted, core's default local store is read. The base
  directory is never printed. Tests always provide synthetic directories.
- `--json`: compact, closed-projection JSON on stdout. Default output is readable
  text with the same observation and trust caveats.
- `--limit <n>`: integer **1–100**, default **50**. Applies separately to each
  top-level list: runs, events, checkpoints, count labels, differences, receipts.
- `--step <step_id>`: only for `inspect`; the public core event validator must
  accept the run/step binding, including the `${run_id}_` prefix and non-empty
  suffix. A syntactically valid but unavailable step returns empty event and
  checkpoint lists, not a claim that it never existed.

`--help`/`-h` and `--version` are accepted alone or with only a command name.
They do not read storage; help/version are text even though observation JSON is
available. No arguments also shows help. Unknown commands/options, duplicate
options, `--option=value`, `--`, extra positional arguments, absent/empty values,
control characters, and inappropriate `--step` uses are rejected. Boolean
options take no value. Limit spelling is decimal without leading zeroes,
fractions, exponents, signs, or whitespace. There are at most 32 argument tokens,
each at most 4,096 characters. Base-directory values must be non-blank,
control-free strings of at most 4,096 characters.

CLI run/step IDs use public core `isSafeSegment`: non-empty ASCII letters,
digits, `.`, `_`, `-`, excluding `.` and `..`. The CLI additionally excludes
leading `-`, embedded known credential/token patterns, and IDs over **128
characters**, and requires public core redaction to leave the ID unchanged.
String-length bounds use JavaScript UTF-16 code units; IDs are ASCII.
There are no separators, absolute paths, URLs, or traversal segments in an ID.
Safe stored identities outside this narrower display contract are withheld.

Nested checkpoint ID lists and receipt provenance lists retain at most **10**
entries each. A receipt observation retains at most **8** sorted stats entries;
core already limits stats to 32 entries. Structured labels/version/type/action
have at most **64** characters, stats keys/strings at most **64**, and retained
opaque references/identifier-like SHA labels at most **128**. Overlong or unsafe
text is replaced as a whole or withheld, never clipped to a token fragment.
Each list reports `{ items, total, omitted }`; `omitted` means a display-limit
omission, not a count of corrupt or unreadable raw records. Separate withheld
counts report identities/references/stats labels rejected by CLI presentation
**after** core reading. Core may have discarded more without reporting them.

The serialized public view and rendered stdout have a hard **1,048,576-byte**
UTF-8 ceiling. If exceeded, the command returns a fixed error with empty stdout;
retry with a smaller `--limit`. This bounds output, **not storage I/O, input-file
size, memory use, or execution time**: public core readers read the whole event
file and scan checkpoint candidates. The CLI is not an untrusted-filesystem
sandbox; it inherits core filesystem/symlink behavior. Input IDs prevent lexical
path escape but do not create a symlink jail. Use a locally controlled store.

## Honest best-effort storage semantics

The CLI uses only public `EventStore.listRuns/readRun` and
`CheckpointStore.listCheckpoints/load`. It never calls append/save, creates
storage directories, writes checkpoints, reads artifact bodies, executes hooks,
models, shell commands, `gh`, or Hindsight, or contacts a network service.

Core returns `[]`/`null` for missing/unreadable storage, skips corrupt JSONL and
invalid/cross-identity events, and omits invalid or incorrectly bound
checkpoints. These readers do not expose an exhaustive corruption/error
inventory. Empty, absent, corrupt-only, and unreadable stores may therefore
produce indistinguishable empty views. A valid run directory with no usable
events may still appear in inventory. Concurrent changes can affect a read;
there is no atomic cross-store snapshot. Exit 0 means a best-effort observation
was rendered, **not** an audit PASS, complete evidence, or successful task.

| Exit | stdout | stderr |
| --- | --- | --- |
| `0` | Observation, help, or version | Empty |
| `2` | Empty | `vista: invalid arguments. Use vista --help.` |
| `1` | Empty | `vista: observation unavailable.` or `vista: output limit exceeded.` |

A broken output pipe also sets exit 1 without exposing the original error.
Errors never include the base directory, raw arguments, record content, original
error messages, or stack traces. Best-effort storage omissions do not produce
fabricated error counts or per-file diagnostics.

## Presentation privacy and trust boundaries

The CLI supplements public core redaction with a **closed projection**. Events
expose only run/step IDs, timestamp, component, action, result, reason code,
source-SHA label, and recorded `vista_version`. Checkpoints expose bound IDs,
timestamp, bounded symbolic step/check/requirement lists, SHA/environment/policy
labels, and `owner_claimed_resumable`. Task goal/current state and other free
narratives, model data, unknown fields, and unknown objects are never dumped.
Safe unknown protocol versions (for example `future/1`) remain inspectable
labels; `version_compatibility` is always `not-assessed`, never current,
compatible, or trusted. Legacy omitted versions remain omitted.

Credential checks do not require word boundaries: wrapped `ghp_…`,
`github_pat_…`, `sk-…`, Slack/JWT/AWS patterns and recognized credential syntax
are rejected even when embedded in otherwise legal labels. Stats use sorted
label/value entries, not arbitrary object keys; unsafe, credential-bearing or
prototype-related property names are withheld. Stats values pass public core
redaction plus short-label/token checks. This is a conservative display policy,
not a claim to identify every conceivable secret encoding. Producers must still
obey the protocol privacy contract. The CLI deliberately cannot recover text
that core has already redacted or discarded.

Receipts retain only safe opaque IDs. Paths, URLs (even core-sanitized URLs),
unsafe types/SHA labels, and credential-bearing refs are withheld and counted;
no ref is dereferenced. `owner_claimed_verified: true` only reports the owning
system's stored boolean, not an independent verification result. Likewise,
`result: ok`, passing-looking stats, SHA labels and resumable flags grant **no
execution, merge, release, or promotion authorization**. All JSON views carry
`observation: recorded-only`, `independent_verification: not-performed`,
`authorization: none`, and the core best-effort notice.

## Public API

```ts
import { observe, parseArgs, runCli } from "@pi-vista/cli";

const parsed = parseArgs(["history", "run-example", "--json"]);
const view = await observe({
  command: "inspect",
  runId: "run-example",
  stepId: "run-example_s0",
  baseDir: "./synthetic-store",
  limit: 10,
});
const result = await runCli([
  "receipts", "run-example", "--base-dir", "./synthetic-store", "--json",
]);
// result: { exitCode, stdout, stderr }; the API does not print it.
```

`parseArgs` and `observe` reject invalid input with fixed-message `CliError`
codes `usage`, `observation`, or `output`. Structured requests reject unknown
keys, getters, inherited request objects, and **explicitly present undefined**
optional fields; omit optional fields instead. `runCli` converts errors to the
fixed process result above. Neither importing the package nor parsing arguments
reads storage. Exported constants describe the same limits as this guide.

## Validation and remaining phases

Parser/API tests and spawned-bin JSON/text tests cover all four commands using
only disposable synthetic stores. Directory inventories and SHA-256 file hashes
before/after prove no storage writes; absent stores stay absent. Tests cover
binding, corrupt/cross-identity/unreadable records, unsafe IDs/keys, core-retained
wrapped tokens, unknown versions, strict errors, deterministic counts and both
nested/byte limits. Repository build/typecheck/test and package dry-run/import/
bin smoke are separate checks; an offline tarball extraction is **not** a clean
consumer install. See [getting-started.md](getting-started.md) and
[PHASES.md](PHASES.md). Promote, replay, Check Function execution/registration,
and Hindsight writes remain future work with separate safety authority.
