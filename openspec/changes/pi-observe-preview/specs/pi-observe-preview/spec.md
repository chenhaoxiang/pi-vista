## ADDED Requirements

### Requirement: Explicit safe observation
The optional bridge SHALL observe only host-supplied safe task/tool metadata, return no Pi behavioral transform, and keep concurrent tool steps distinct.

#### Scenario: Concurrent and failed storage
- **WHEN** tools complete out of order or a store stalls/rejects
- **THEN** tool execution/results remain unchanged, steps correlate correctly and observation loss is non-authorizing

#### Scenario: Valid identity encountered on a loss path
- **WHEN** an unmatched end or a start with lost metadata exposes a valid native call ID
- **THEN** a capped non-correlatable record prevents later reuse from rebinding an old result to a fresh step

### Requirement: Controller-lifetime history-clock monotonicity
The bridge SHALL preserve observed history-clock high-water across replacement previews and epochs without invoking host callbacks during construction.

#### Scenario: Expiry followed by rollback
- **WHEN** history is rejected as expired and the host clock subsequently moves backward
- **THEN** another preview and local adoption remain refused in the same controller even after epoch reset

### Requirement: Historical guidance is not current proof
Preview SHALL reuse authenticated original historical documents, exact selection bindings and character budgets without automatic model/editor injection or memory writes.

#### Scenario: Explicit adoption
- **WHEN** the user selects an exact current preview digest
- **THEN** only a local guidance acknowledgement is recorded and execution/authorization/current proof remain absent

### Requirement: Missing and current evidence remain distinct
Status SHALL report absent owner receipts as MISSING; only fresh private verifier proof may yield current-verified for its exact run bindings.

#### Scenario: Copied historical flags
- **WHEN** signed history, copied flags, foreign proofs or expiry are presented
- **THEN** no current proof or permission is restored
