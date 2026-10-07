## ADDED Requirements

### Requirement: Explicit exact receipt consumption
The file addon SHALL only consume complete existing v1 envelopes from explicitly configured private local files. It SHALL not modify root verifier semantics, add unsigned binding or coverage fields, re-sign claims or turn legacy/synthetic observations into authority.

#### Scenario: Valid source
- **WHEN** an owner-configured file supplies a complete valid signed receipt under the explicit file encoding contract
- **THEN** an exact detached envelope reaches the unchanged verifier and only that verifier may mint current non-authorizing proof after all checks

#### Scenario: Incompatible owner material
- **WHEN** audit flags, candidate envelopes or synthetic IPC tickets are supplied
- **THEN** the reader/verifier refuses them and producer compatibility remains missing

### Requirement: Bounded read-only private transport
The addon SHALL use fixed private host mappings and read-only no-follow/nonblocking finite POSIX file operations, bound bytes/elapsed waits, recheck cancellation before subsequent I/O, detect observed mutation/replacement and avoid default discovery/network/signing/creation or runtime cleanup.

#### Scenario: Race or cancellation
- **WHEN** a configured file changes during a read or cancellation/deadline becomes visible
- **THEN** the operation rejects with a fixed private error and no repair/write/permission effect

### Requirement: No provenance restoration
Repeated verification SHALL freshly reread files and retain the existing source/binding/expiry/check/coverage/private-handle contract.

#### Scenario: Restart or serialized proof
- **WHEN** a separate process consumes safe persisted signed receipts
- **THEN** it verifies independently, cannot restore old proof identity from flags and cannot bypass source or lifecycle checks
