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

### Requirement: Continuity helpers shall not alter unrelated execution or memory
Continuity helpers SHALL remain explicit optional observation. They SHALL NOT change Hindsight or surrounding memory paths, native models/tools/permissions, existing Gate decisions, canonical transcripts or task execution. Missing observers SHALL NOT become new mandatory gates.

#### Scenario: The optional path is unavailable
- **WHEN** the helper, observer or display path is absent or fails
- **THEN** the original native task and required checks SHALL retain their existing behavior
- **AND** no global execution barrier or automatic replay SHALL be introduced
