---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-18
verified: 2026-10-18
verification_scope: Offline non-gating capability-evaluation contract and local-extension audit boundaries
owner: chx
ssot: true
---

# Offline AI capability evaluation and local-extension audit

This slice adds a bounded, offline evaluation contract to the existing Pi-Continuum
Evaluation plane. It observes safe projections and static source/config facts only;
it does not create an execution gate, permission source, model router, approval ledger,
provider adapter, or production acceptance path.

## Requirements

1. **Concrete synthetic matrix**
   - Define exactly ten normal engineering tasks (`T01`–`T10`) with self-contained
     synthetic inputs and manually checkable acceptance criteria.
   - Keep task prompts and criteria independent of a prescribed tool-call sequence.
   - Freeze the exported task and fixture objects so a caller cannot alter the rubric
     between runs.

2. **Closed safe-projection runner**
   - Support explicit `--matrix`, `--demo`, `--template`, and `--summarize` modes,
     with JSON and Markdown output only.
   - Consume only a closed `ai-capability-evaluation-input/1` DTO from stdin for
     supplied observations; reject unknown keys, raw prompts/output, credentials,
     paths, proxy details, getters, proxies, malformed arrays, duplicate identities,
     and unsafe numeric values without echoing private input.
   - Emit fixed non-authorizing safety metadata:
     `observation=recorded-only`, `verification=metadata-only`,
     `authorization=none`, `executable=false`.
   - Preserve `null` for missing measurements. Never infer completion, ROI, price,
     model quality, permission, or current verification from fixture presence or
     supplied counters.
   - Require a known denominator before calculating false-intercept rate and keep
     error-recovery observations with unknown outcomes unclassified.

3. **Local-extension audit boundary**
   - Keep the extension review as a documented, static, read-only snapshot of safe
     fields and source wiring.
   - Treat conventional-discovery eligibility as distinct from proof that a given
     session loaded an extension; unknown loading state must remain unknown.
   - Do not read auth/model/environment/session contents, call a provider, alter
     settings or extensions, execute guard/shadow branches, or change the Pi main
     execution, permission, gate, or notification contracts.

4. **Non-gating validation**
   - The new manual suite may be invoked explicitly, but must not be added to the
     default `test`, release-contract discovery, CI, or Gate scripts.
   - Existing source/build/typecheck/consumer/release contracts remain authoritative
     and must not be weakened or replaced by this evaluation slice.
   - Evidence must distinguish source, local test, CI, review, merge, deployment,
     release, and real AI/model observations; synthetic checks never prove real
     capability or effectiveness.

## Out of scope

Provider/model calls, raw-session replay, credential or `.env` access, bank writes,
Pi settings changes, extension installation or reload, automatic model selection,
permission or approval decisions, Gate/CI admission, ROI ranking, production,
financial, release, or deployment actions.
