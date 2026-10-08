## ADDED Requirements

### Requirement: Explicit local trusted-host mode shall remain distinct
The local evidence addon SHALL require explicit local-host mode and scope, trusted pinned native collection callbacks and clock. It SHALL NOT create/read keys, assert human/macOS authentication, discover stores/profiles, auto-install hooks or weaken the signed verifier, original Learning or portable archive identity boundary.

#### Scenario: Current user approves the local scope
- **WHEN** the host explicitly selects the user-approved single-owner local mode
- **THEN** it MAY collect actual local results without a signer
- **AND** a screen-unlocked/UID/JSON approval claim alone SHALL NOT establish result truth or new execution authority

#### Scenario: An unsigned or copied view enters the signed path
- **WHEN** a local verifier, observation, JSON view or copied handle is supplied to the original signed verifier/learning path
- **THEN** it SHALL NOT become a signed factory identity, receipt or current proof

### Requirement: Local current proof shall bind complete successful observations
The verifier SHALL validate closed detached schema1 gate/test/guard observations, exact scope, kind/producer/source pins, five binding fields, positive complete coverage, required successful cases/checks, freshness and validity. Unknown, lossy, skipped, failed, overridden, incomplete, conflicting or hostile data SHALL refuse without repair.

#### Scenario: Actual fixed-plan source acceptance
- **WHEN** the opt-in host executes the unchanged source/consumer gates and reconciles native counters, source pins and all declared fixed host admissions
- **THEN** the verifier MAY produce an opaque local-host-process proof for that declared scope
- **AND** authorization SHALL be none and executable SHALL be false
- **AND** it SHALL NOT imply nested-child/OS/Meta guard coverage, model acceptance or release permission

#### Scenario: The expected binding differs
- **WHEN** any run/repo/source/policy/environment binding or scope differs
- **THEN** verification SHALL fail, without relabeling or filling observations

### Requirement: Local proof lifetime shall not survive copying or failure
Only exact current verifier-owned handles SHALL pass provenance checks. Revalidation SHALL re-collect all sources, compare immutable observation digests and rotate the handle without extending its previous deadline; failed revalidation SHALL revoke the challenged handle. A factory-lifetime monotonic anchor SHALL make fixed-wall elapsed freshness non-renewable even through direct verify; collection crossing expiry SHALL refuse. Malformed/mismatching isCurrent queries SHALL return false without consuming a valid handle. Copying, serialization, another factory, restart, expiry, clock rollback, shutdown or late callback completion SHALL NOT restore current evidence.

#### Scenario: History is recalled after restart
- **WHEN** persisted local evidence or guidance is loaded in a new process
- **THEN** current verification SHALL remain not checked
- **AND** fresh trusted-host collection SHALL be required before any current verified workflow

#### Scenario: The host changes or fails on revalidation
- **WHEN** any observation digest changes, collection fails or its scope/pins/freshness are invalid
- **THEN** the old proof SHALL be revoked and revalidation SHALL refuse

### Requirement: Local acceptance shall be explicit and bounded
Ordinary tests/CI SHALL use offline synthetic seams. The effectful local acceptance command SHALL require opt-in and exact source identity, fixed commands, bounded deadlines and test-owned tmp output. It SHALL NOT call live models/banks, change Meta policy or daily configuration, or treat native case counts as semantic/production coverage.

#### Scenario: No opt-in is supplied
- **WHEN** the acceptance command is imported or invoked without explicit admission
- **THEN** import SHALL not perform I/O and invocation SHALL refuse before source/consumer execution
