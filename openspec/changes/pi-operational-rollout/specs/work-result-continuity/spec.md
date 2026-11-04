## ADDED Requirements

### Requirement: Work references shall retain original owner identity
The explicit Pi work adapter SHALL bind an existing owner/kind/key, stage, run, session, revision and optional exact head without creating a task store or execution authority. It SHALL reject unsafe or ambiguous metadata without inventing a work identity or executing accessors.

#### Scenario: Another work or attempt is supplied
- **WHEN** an owner readback differs in work, stage, run, session, revision or head
- **THEN** the observation SHALL remain unresolved for the supplied binding
- **AND** it SHALL NOT update the other work or successor

#### Scenario: An input field is an accessor or proxy
- **WHEN** supplied objects or arrays contain unsupported accessors, proxies, sparse elements or unknown fields
- **THEN** the adapter SHALL reject the input without executing those accessors
- **AND** refusal diagnostics SHALL NOT include raw private values

### Requirement: Result consumption shall read the explicit original owner
The optional reader SHALL require an explicitly injected trusted-host read-only callback and a bounded existing result reference. It SHALL install no default reader, store, network, history scan, model call or task writer. A copied result flag SHALL NOT authenticate its source or grant permission.

#### Scenario: A reader fails or times out
- **WHEN** the configured reader throws, rejects or exceeds the observation deadline
- **THEN** only the observation SHALL become unknown
- **AND** native execution SHALL continue without cancellation, replay or unhandled late rejection

### Requirement: Delivery observations shall respect the original stage acceptance
A deliverable observation SHALL require matching current owner acceptance, all declared required evidence and successful accepted required effects. Terminal execution alone SHALL NOT prove successful delivery. The output SHALL remain read-only and non-authorizing, not an independent proof or acknowledgement that the user received a result.

#### Scenario: A worker has one green test but required CI is absent
- **WHEN** the original code stage declares both test and CI originals and one is missing, foreign, stale or conflicting
- **THEN** the observation SHALL NOT declare that stage deliverable

#### Scenario: Required effects remain unresolved
- **WHEN** a required effect is pending, unknown, failed, cancelled or not accepted by its original owner
- **THEN** the observation SHALL NOT upgrade it to successful delivery
- **AND** the native effect reference SHALL remain available to the owner

#### Scenario: Independent work is pending
- **WHEN** unrelated work, advisory evidence or another stage is pending
- **THEN** it SHALL NOT impose a global barrier on this stage's satisfied acceptance

#### Scenario: The original task is a report
- **WHEN** a report stage satisfies its own declared owner acceptance
- **THEN** it MAY be observed as deliverable without imposing code CI
- **AND** the report SHALL NOT thereby certify external business effects

### Requirement: Fresh handoff observations shall preserve original results
The adapter SHALL bind the existing GovernanceHandoff to the original binding and a distinct successor run/session for the same work and stage. Accepted facts, blockers and unresolved native-effect references SHALL remain available. The observation SHALL NOT resume execution, verify the successor head or restore current proof.

#### Scenario: A late original result arrives after successor acceptance
- **WHEN** an old result is read against the current successor owner binding
- **THEN** the old result SHALL NOT overwrite or settle the successor
- **AND** its original run and result reference SHALL be retained for owner handling

#### Scenario: The successor has its own revision and changed source
- **WHEN** the original packet matches its original run revision and the successor has a new run/session
- **THEN** the adapter SHALL NOT invent a shared monotonic revision counter
- **AND** current head verification SHALL remain not checked until original-owner readback

### Requirement: Selected fresh-session host observation shall remain a forward-only sidecar
An explicitly selected host entry SHALL observe only sessions created at or after its fixed cohort timestamp. It SHALL inspect native header/current-event metadata without scanning or modifying transcripts. Todo states, including completed, SHALL remain unverified delivery; session-local traces SHALL NOT be represented as globally durable work records.

#### Scenario: New session or old session is loaded
- **WHEN** the native session header is within the selected new-session cohort
- **THEN** forward lifecycle and current Todo structured-result observations MAY be recorded in the existing local EventStore
- **AND** an older session or missing native identity SHALL NOT acquire a fabricated work or delivery state

#### Scenario: A trusted owner supplies an original result reader
- **WHEN** the same-process host explicitly supplies an owner reference and read-only original-record callback for the current host session
- **THEN** the host SHALL use the existing bounded result-consumption API without inferring original acceptance from Todo or worker flags
- **AND** the callback and its metadata SHALL NOT be presented as independent origin authentication

#### Scenario: Observation finishes after the host session changes
- **WHEN** a prior session's owner read finishes after replacement
- **THEN** safe observation metadata SHALL retain its original observer identity
- **AND** it SHALL NOT call the old consumer into the replacement session, settle new work, cancel the original read or discard native artifacts/effects

#### Scenario: Observation fails or reaches a bounded capacity
- **WHEN** registration, storage, input or the observation capacity fails
- **THEN** fixed diagnostics and coverage status SHALL report the observation limitation
- **AND** native tools, task acceptance, model behavior and required checks SHALL continue unchanged

### Requirement: A native Subagents result adapter shall use an explicit mission and original artifacts
The host SHALL associate current native Subagents events with the existing mission/run/session and explicitly referenced single artifact. It SHALL read bounded regular original files without following symlinks or scanning history, emit only safe non-authorizing metadata, and keep artifact availability separate from task acceptance, code checks or business completion.

#### Scenario: A native mission completes with one original output
- **WHEN** the current Subagents owner event matches the mission/run/session and its mission/status/process/output originals are readable and unchanged
- **THEN** the observer MAY report an accepted artifact-availability observation for that run-scoped work reference
- **AND** it SHALL retain `authorization:none`, `readOnly:true` and `taskAcceptance:not-checked`

#### Scenario: Native completion is missing or contradicted
- **WHEN** mission identity, owner session, process terminal proof, output membership, file stability or native status is missing/contradictory
- **THEN** the observation SHALL remain unknown/reportable-terminal and SHALL NOT treat a success flag or Todo completion as delivery

#### Scenario: A duplicate or late native event arrives
- **WHEN** the same run notification repeats, arrives before launch association, or arrives after the host session was reset
- **THEN** it SHALL be deduplicated, retained until bounded association where safe, or ignored for the replacement session
- **AND** it SHALL NOT replay execution or call a stale consumer; an identical completion notification SHALL NOT trigger another original read

### Requirement: Explicit code-owner readback shall use original source and merge evidence
The opt-in code-owner host SHALL read an explicitly selected PR/head/base, declared check names with pinned App IDs, merge workflows and original premerge Gate report. It SHALL not execute Gate, merge, CI, retries or deployments. Missing, foreign, failed, incomplete or post-merge-only Gate evidence SHALL remain unknown; an accepted result SHALL only describe source-shared delivery and never grant permission.

#### Scenario: All declared source originals match
- **WHEN** the original PR/head/base, latest matching source checks, review hash when required, merge workflow and base ancestry match a successful premerge Gate and actual merge
- **THEN** the existing result consumer MAY report source-shared-delivery as accepted
- **AND** unrelated advisory checks SHALL not become a global barrier

#### Scenario: The supplied Gate was evaluated after merge
- **WHEN** its evaluation finished after the original merge time or its merge observation says already-merged
- **THEN** it SHALL NOT substitute for original premerge Gate evidence even when current CI is green

#### Scenario: A required source changes during readback
- **WHEN** the PR head/base/merge binding changes, a newer matching check is pending/failed, or a returned collection is incomplete
- **THEN** the observation SHALL remain unknown without modifying or retrying the original task

### Requirement: Continuity helpers shall not alter unrelated execution or memory
Continuity helpers SHALL remain explicit optional observation. They SHALL NOT change Hindsight or surrounding memory paths, native models/tools/permissions, existing Gate decisions, canonical transcripts or task execution. Missing observers SHALL NOT become new mandatory gates.

#### Scenario: The optional path is unavailable
- **WHEN** the helper, observer or display path is absent or fails
- **THEN** the original native task and required checks SHALL retain their existing behavior
- **AND** no global execution barrier or automatic replay SHALL be introduced
