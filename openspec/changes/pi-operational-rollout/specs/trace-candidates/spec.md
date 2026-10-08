## ADDED Requirements

### Requirement: Bounded non-authorizing trace draft
Stage2 SHALL form only an explicit safe ExperienceObservation draft from bounded closed metadata and exact5bindings, without I/O or fabricated verification.

#### Scenario: Missing or lossy run
- **WHEN** bindings, toolpairs, lifecycle settlement or no-loss metadata is missing/conflicting
- **THEN** the draft refuses rather than filling evidence or returning a successful partial experience

### Requirement: Parallel display order is not execution dependency
Draft steps SHALL preserve source step IDs and original result pairs; deterministic presentation order SHALL NOT manufacture dependencies or complete coverage.

#### Scenario: Out-of-order event storage
- **WHEN** valid overlapping toolpairs arrive in reordered persisted metadata
- **THEN** the same safe draft/provenance is produced without relabelling a result or creating depends_on links

### Requirement: Candidate integration stays explicit
Draft output SHALL NOT be a current lifecycle handle, proof, automatic nomination or sink write.

#### Scenario: Copied draft supplied as proof
- **WHEN** copied serialized draft/status is offered for verification or selection
- **THEN** unchanged evidence/learning APIs refuse to restore authority; explicit observe/nominate stays observed/candidate
