---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

## ADDED Requirements

### Requirement: Authority-bound receipts
The verifier SHALL require pinned issuer keys, signatures, content digests,
complete required evidence and matching run/repo/source/policy/environment bindings.

#### Scenario: Flags cannot impersonate evidence
- **WHEN** a caller supplies passed/verified flags or unsigned legacy audit data
- **THEN** verification fails closed and grants no authority

#### Scenario: Evidence changes or expires
- **WHEN** a signature, binding, required check, digest or freshness fails
- **THEN** neither a Check Function pass nor a trusted learning state is produced

### Requirement: Explicit bounded promotion
Promotion SHALL preview safe content and require digest confirmation, fresh
receipts and an explicitly injected Hindsight sink. A failed or uncertain sink
SHALL NOT produce trusted state.

#### Scenario: Dry-run is read-only
- **WHEN** a candidate is prepared
- **THEN** the exact proposed document is returned and the sink is not called

### Requirement: Safety authority separation
Replay, shadow and retrieval SHALL remain non-executing and SHALL NOT override
owner gates, shadow eligibility, isolation, production, release or training limits.

#### Scenario: Shadow agreement is not permission
- **WHEN** sanitized model observations agree
- **THEN** the result remains observational with authorization none
