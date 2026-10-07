---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
ssot: true
---

# Explicit receipt files: consumer transport only

`@pi-vista/evidence/files` is an opt-in **read-only local POSIX consumer**.
It supplies `EvidenceSource` callbacks, not verification, signing, permission,
a publisher or owner integration. The evidence root does not import/export this
addon. Importing either the addon or its factory performs no filesystem I/O.
The unchanged [verifier](authoritative-evidence.md) alone authenticates signatures,
content digests, issuer/kind, all five bindings, freshness, required successful
gate checks/test suites and complete clean guard coverage, and mints opaque proof.

**Actual compatible owner producers and public-key provenance: MISSING / not
accepted.** Synthetic source/package tests do not fill this gap. A valid signature
only authenticates the pinned issuer's claim, not the claim's correctness, owner
identity/key custody, coverage truth, isolation or current execution/merge/release
permission. Nothing here changes guard/gate policy, defaults, CLI or Pi hooks.

## Explicit private host configuration

```ts
import { createReceiptFileSources } from "@pi-vista/evidence/files";
import { createEvidenceVerifier } from "@pi-vista/evidence";

const sources = createReceiptFileSources({
  root: explicitExistingPrivateDirectory, // canonical absolute POSIX directory
  max_bytes: 16384,
  timeout_ms: 1000,
  sources: [
    { subject: "owner-gate", file_id: "gate", issuer: "owner-1",
      kind: "gate", public_key: explicitlyPinnedPublicPem },
    { subject: "owner-tests", file_id: "tests", issuer: "owner-1",
      kind: "test", public_key: explicitlyPinnedPublicPem },
    { subject: "owner-guard", file_id: "guard", issuer: "owner-1",
      kind: "guard", public_key: explicitlyPinnedPublicPem },
  ],
});
const verifier = createEvidenceVerifier({
  sources,
  gate_checks: explicitRequiredChecks,
  gate_version: explicitGateSourceSha,
  gate_config_digest: explicitGateConfigDigest,
  test_suites: explicitRequiredSuites,
  now: trustedHostClock,
  max_age_ms: 600000,
  timeout_ms: 2000,
});
// Only this verifier can mint proof after its normal independent checks.
const proof = await verifier.verify(expectedFiveBindings, {
  gate: "owner-gate", test: "owner-tests", guard: "owner-guard",
});
// proof.authorization === "none"; copied/serialized views have no provenance.
```

All config fields are required. `sources` has 1–64 closed own-data mappings;
subjects are unique safe symbolic labels and `file_id` labels are unique even
case-insensitively (to avoid case-folded filesystem aliases). Issuer/kind and
canonical SPKI Ed25519 **public** PEM including its final LF must be explicit.
Private/mixed/noncanonical/non-Ed25519 pins reject before I/O. Config records must
be ordinary/null-prototype own data; Proxies, accessors, unknown/undefined fields,
custom/sparse arrays and unsafe labels reject without invoking their hooks.
`max_bytes` is an integer 1–1,048,576; `timeout_ms` is 1–10,000. Root syntax is a
canonical absolute path with no trailing slash, traversal, backslash or control
characters; root itself cannot be `/`. Existence/ownership is checked on each read,
not during construction. There is no cwd/home/environment discovery or fallback.

The factory snapshots mapping/config and returns a frozen array of frozen
sources with **only** `subject`, `issuer`, `kind`, `public_key`, `read`. Private
root/file mappings never appear in sources, proofs or errors. Each callback takes
only a native same-realm `AbortSignal`, returns a native Promise and opens the
fixed `<file_id>.receipt.json` anew. No operation-path argument, cache, polling,
network, IPC, signer or alternative resolver is installed.

## Opt-in producer encoding, not legacy compatibility

A file is **exact sorted-key canonical UTF-8 JSON** for the existing closed v1
`{payload, content_digest, signature}` envelope, optionally followed by one LF.
All original payload fields must already validate through `evidenceMessage` and
be exactly equal to its canonical form. SHA/digest case and other signed fields
are not silently normalized. Envelope digest is lowercase 64-hex; signature is
canonical base64 for exactly 64 bytes. The unchanged verifier independently
checks that the digest and signature actually authenticate the signing message.

No whitespace, reordered keys, duplicate keys, BOM, invalid UTF-8, CRLF, extra
LF, unknown fields, trailing bytes, multiple records or partial JSON are accepted.
The reader compares the entire canonical envelope to the original decoded bytes;
it returns a deeply frozen detached exact envelope, **not a current proof**.
Hosts implementing a producer must deliberately adopt this file transport
encoding in addition to the existing evidence signing contract. This requirement
does **not** assert that any current legacy owner output conforms.

| Existing material | Current v1 evidence compatibility |
| --- | --- |
| Unsigned audit flags / observational receipts | Unsupported, even labelled passed/verified |
| Candidate asset manifests | Unsupported; not gate/test/guard current proof |
| Synthetic transport tickets | Unsupported; test transport success is not owner truth |
| App authentication / checkrun metadata | Unsupported; authentication or CI status is not this receipt contract |
| Complete correctly signed synthetic v1 file | Transport-compatible; verifier still checks all pins/bindings/details/time |
| Actual owner producer and pinned key provenance | **MISSING / separately unaccepted** |

The consumer never creates missing binding/time/details fields, fabricates test
counts/guard coverage, converts an owner override to PASS, re-signs records or
chooses a success verdict. No private owner format, record, source or strategy is
copied into this public contract.

## Read-only filesystem and cancellation contract

Each read rejects ancestor/root symlinks, requires a current-uid root directory
with exact mode 0700 and a regular current-uid single-link file with exact mode
0600, positive size and configured byte bound. FIFO/socket/directory/hardlink,
unsafe permissions, missing files, short/truncated or growing files reject.
Read-only opens include `O_NOFOLLOW | O_NONBLOCK` (and `O_DIRECTORY` for root).
Root/file descriptors remain held through before/after stat and path samples.
Device/inode/owner/mode identity is compared along the root components; full
root/file link count, size and nanosecond mtime/ctime metadata must also remain
unchanged. Observed in-flight rename/substitution/mutation refuses the read.
A safely published new valid file **before a later read** is reopened freshly;
`revalidate` still requires the reviewed receipt digests, not a cached success.

The reader never creates, writes, chmods, locks, deletes, renames, repairs or
cleans up files. It checks native abort state and an absolute monotonic deadline
after awaited preflight/read operations and before subsequent I/O. Descriptors
obtained from a late open are retained before checking cancellation, and all owned
descriptors are closed in `finally` even after abort/deadline/error. Success also
checks cancellation/deadline after closure. Native OS waits, JS work and scheduler
delays cannot be preempted: this is not a hard CPU/process/hostile-callback sandbox.

Direct reads use fixed `EvidenceError` codes: `invalid-config` for configuration,
`invalid-input` for non-native signal, `unverified-evidence` for abort/transport/
syntax/metadata refusal, `evidence-timeout` for reader deadline. Messages/stacks
contain only the fixed code, never the original FS error, path, source or key.
The unchanged verifier may collapse reader errors to `unverified-evidence`.

**Limits:** native filesystem/clocks/realm and a cooperating current-user POSIX
host are trusted. Path/stat checks are point-in-time observations, not an atomic
filesystem jail, hostile-host defense, atomic three-receipt snapshot, NFS/distributed
consistency guarantee or durable revocation service. Transient undetected changes,
host/key compromise and owner truth remain outside this contract. Offline
`isCurrent` checks opaque identity/bindings/expiry only; it does not poll files or
discover revocation. Promotion alone revalidates freshly through the unchanged
[learning](learning.md) confirmation/sink boundary. Serialized/copied/foreign proof
handles remain unusable after restart; new independent verification is required.

## Validation boundary

New tests use only generated disposable Ed25519 keys and invocation-owned files
under checkout `tmp/`. They exercise native files, malformed/private input,
signed negative bindings/details/time, legacy refusal, publication replacement,
FS mutation/cancellation and real fresh public-addon producer/consumer processes
with an explicitly confirmed **synthetic in-memory** learning sink. Interception
is confined/restored in fresh test children. Existing assertions/verifier/learning
are unchanged. The sole build-exclusion addition is `src/**/*.fixtures.ts` in the
evidence tsconfig, preventing generated synthetic helpers entering tarballs.

The generic [release gates](release-contract.md) remain unchanged: 11 public
packages, 18 export specifiers including this addon, actual retained npm consumers,
strict consumer-installed locked TypeScript and packed privacy/bin checks. Local
source/installed proofs are not independent review, hosted CI, registry publication,
actual owner integration, operational acceptance or current safety permission.
