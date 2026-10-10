---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-10
---

# @pi-vista/learning

Opt-in, model-agnostic experience lifecycle, explicitly confirmed promotion, and
non-executing offline replay/retrieval/context/evaluation. This ESM package uses
`@pi-vista/evidence`'s exact factory-branded verifier; flags and serialized reports
cannot mint verification or trust.

```ts
import { createLearningLibrary, HINDSIGHT_CUSTOM_PAGES } from "@pi-vista/learning";

// The host supplies a createEvidenceVerifier() result and, optionally, both
// native-promise sink callbacks. No transport, owner wiring or hooks are installed.
const library = createLearningLibrary({ verifier, sink });
const candidate = library.nominate(library.observe(safeObservation));
const proof = await verifier.verify(expectedBindings, ownerSubjects);
const verified = library.verifyCandidate(candidate, proof);
const plan = library.preparePromotion(verified, "repo-bank-alias"); // no I/O
// After the host/operator reviews this exact bank + title + content + tags:
const trusted = await library.commitPromotion(plan, {
  preview_digest: explicitlyConfirmedDigest,
});
const selection = library.retrieve([trusted], safeRetrievalQuery); // offline
const context = library.compileContext(selection, { max_characters: 8192 });
// context.authorization === "none"; character bounds are NOT token bounds.
// HINDSIGHT_CUSTOM_PAGES is configuration data only, not an installer.
```

The names above are explicit host inputs, not defaults. Use symbolic metadata,
not commands, paths, model prose, credentials or artifact content. Sink callbacks
are trusted code and must map a safe bank alias, honor idempotency and truthfully
read back persisted content. Acknowledgements alone never create trusted state.
One confirmed attempt consumes the experience's promotion opportunity in that
library, even after a failure; there is no automatic retry or durable coordinator.

Portable history is additive: optional `archive` supplies a scoped archive-origin
public pin, trusted clock and signer callback. `prepareArchive` re-reads current
owner evidence before signing safe derived metadata, and `commitArchive` confirms
the exact preview and existing sink/readback without raising current trust.
`createPortableRecall` independently verifies original signed documents through
explicit public pins/age policy and optional Hindsight query/read/lifecycle ports.
Historical context is non-executing/current-verification-not-checked;
`importHistorical` creates only an observed new-run record. No default client,
bank, signer, credentials or Pi injection is installed. See
[docs/portable-recall.md](../../docs/portable-recall.md) for exact schemas/policies,
separate-process synthetic proof and trusted-host/durability limits.

The explicit `createHindsightStore({ endpoint, banks, journal_directory, ... })`
factory, imported only from `@pi-vista/learning/hindsight`, returns frozen `sink`,
`port` and remote-read-only `reconcile` APIs. It uses pinned Hindsight 0.10.2 synchronous retain plus independently matched
original-document GET, not generated facts/pages. An exclusive synced intent in
an existing private local POSIX root precedes retain; existing/uncertain/partial
claims never allow a second POST. Endpoint/token/paths stay private, with no
import/factory I/O, defaults, hidden retry, lease/reset/deletion or activation.
Portable recall still independently authenticates signatures; matched persistence
cannot restore current proof. See [the store guide](../../docs/hindsight-store.md)
for closed configuration, HTTP/abort/byte bounds, journal and trusted-host limits.
Actual service/durability/owner acceptance remains pending.

Root public exports: `createLearningLibrary`, `createPortableRecall`, `classifyFailure`,
`HINDSIGHT_CUSTOM_PAGES`, `LearningError`, the bounds, and API types. Library methods:
`observe`, `nominate`, `verifyCandidate`, `reject`, `deprecate`, `supersede`,
`preparePromotion`, `prepareCorrection`, `commitPromotion`, `planReplay`,
`compareRecorded`, `retrieve`, `compileContext`, `evaluateRetrieval`,
`modelStatistics`, `prepareArchive`, `commitArchive`, and `importHistorical`.
Portable recall methods: `authenticate`, `select`, `recall`, and `compileContext`.
The opt-in `./hindsight` subpath alone exports `createHindsightStore` and its config /
reconciliation/store types; the root import graph has no addon I/O dependencies.

The separate optional `@pi-vista/learning/pi` subpath exports
`createPiObservation` and frozen controller/config/status/preview types. A trusted
host explicitly loads seven public notification hooks and supplies safe task/tool
metadata, clocks and optional store/history/evidence ports. Original signed
historical Script/Step preview can be acknowledged locally by exact private
identity/digest, without prompt/editor injection, execution or memory write.
No default stores, environment/session discovery, SDK dependency, settings or
activation is added; root runtime remains unchanged. See
[the Pi observation/preview guide](../../docs/pi-observe-preview.md) for quotas,
failure handling, current-vs-historical proof, controller-lifetime clock/lost-ID
limits and the installed SDK declaration limitation. Source PR18 acceptance is
recorded in [the closeout](../../docs/handoff/2026-10-07-pi-observe-preview-source-closeout.md). Pi1.0.4 needs Node22.19+; Node20 support is
for this library/mock-host seam, not the host SDK.

The separate `@pi-vista/learning/local` subpath exports `createLocalLearningLibrary`
and LOCAL types. It accepts only the exact `createLocalEvidenceVerifier` identity
and configured scope, preserves root/signed acceptance, and explicitly composes
safe observation/candidate/current proof, exact guidance preview/confirmation,
one-shot retain/readback, read-only reconciliation, original-history recall/import
and process-local lifecycle/context. `persisted` is non-authorizing and historical
content stays not-checked/none/false. No default client, Pi injection or new real
bank operation is installed. See [the LOCAL guide](../../docs/local-learning.md).

Full input schemas, confirmation/transport semantics, lifecycle and privacy
limits: [docs/learning.md](../../docs/learning.md) in the source repository.
This package does not authorize execution, repair, merge, release, model routing
or production changes and does not override workspace-guard or ai-gate.
