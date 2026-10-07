---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

## ADDED Requirements

### Requirement: Portable origins are authenticated
Archive export SHALL originate from authentic fresh verified/trusted library state, and portable historical import SHALL verify pinned producer signature, canonical digest, bank/repo scope and lifecycle/revocation policy. Stored flags and copied handles SHALL NOT restore provenance.

#### Scenario: Another process recalls a historical skill
- **WHEN** a new process retrieves an exact signed safe archive from an explicit Hindsight port
- **THEN** it can produce bounded authenticated-historical guidance with current-verification-not-checked and authorization none

#### Scenario: A record claims trusted
- **WHEN** a caller or stored record supplies labels or altered signed payload
- **THEN** it cannot mint a live verified/trusted handle or execution permission

### Requirement: Reuse preserves current safety authority
Historical context and observed-only import SHALL remain non-executing. Current verification/promotion SHALL use the existing fresh authoritative receipt boundary without clock backdating or expiry bypass.

#### Scenario: Old successful provenance is stale for current execution
- **WHEN** the original gate/test/guard receipts expired or current source/policy/environment differs
- **THEN** history can at most remain labelled guidance; it cannot satisfy current admission or promotion

### Requirement: Memory access is explicit and bounded
There SHALL be no default Hindsight network/credential/bank/Pi hook. Explicit host ports SHALL enforce bounded own data, safe metadata, value-free errors and fixed deadlines; writes SHALL require exact preview confirmation and no uncertain success.

#### Scenario: Cross-process synthetic validation
- **WHEN** producer and consumer execute in separate fresh Node processes with disposable file-backed fixtures
- **THEN** no old WeakMap/state, real service or credentials are needed to authenticate history and no live permission is created

### Requirement: Historical lifecycle policy is explicit
Historical key intervals, revocation and age policy SHALL be host-pinned and
bounded. Missing lifecycle coverage SHALL say not-checked rather than current
active. An optional trusted policy reader SHALL bind fresh coverage to exact
archive origin/scope/digest; withdrawn outcomes SHALL reject.

#### Scenario: Original receipt/key validity interval ended
- **WHEN** a signature claimed inside an explicitly accepted historical key interval is recalled after original receipt expiry
- **THEN** bounded history may authenticate but SHALL NOT satisfy current owner checks

#### Scenario: Lifecycle coverage is missing, stale or withdrawn
- **WHEN** policy has no coverage, stale coverage or a deprecated/revoked/rejected/superseded state
- **THEN** it SHALL respectively label not-checked or reject, never grant current reusable trust

### Requirement: Observed import never restores current proof
Import SHALL require an authentic historical identity and explicit new ID/run/current
bindings. Non-run binding drift SHALL reject. Imported script/steps SHALL start
observed with safe origin references; old failure/model measurements SHALL remain
historical, and current verification SHALL use new ordinary owner proof.

#### Scenario: Copied history or a stored trusted label tries to verify a new run
- **WHEN** old projections/signature/status are supplied to current verification
- **THEN** they SHALL be refused without minting current proof or changing lifecycle

### Requirement: Writes preserve exact confirmation and uncertainty
Archive upload SHALL require exact private preview/digest confirmation, current
owner revalidation, exact native-promise ingest and matching full readback. One
consumed attempt SHALL prevent racing/uncertain retry in that library, without
claiming durable cross-process locks, retries or rollback.

#### Scenario: A host read/write callback fails, times out or returns late
- **WHEN** signer/query/read/ingest/readback/policy is uncertain or malformed
- **THEN** no authenticated success/current trust/partial recall SHALL be fabricated,
  waits SHALL be bounded with abort and late rejection consumed, and errors SHALL be value-free
