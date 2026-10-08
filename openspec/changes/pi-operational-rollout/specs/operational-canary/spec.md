## ADDED Requirements

### Requirement: Actual isolated runtime evidence
Stage1 SHALL use actual public AgentSession plus the explicitly approved model and bounded fixture tools, and SHALL distinguish it from mocked SDK dispatch.

#### Scenario: Model task and observation failure
- **WHEN** a model task calls its constrained tools while observation storage stalls or rejects
- **THEN** the task/tool result remains intact, metadata loss is explicit and raw task/model data is not recorded

### Requirement: Readonly secret use and no default activation
Canary SHALL keep settings/session/catalog test-owned or in-memory and prevent auth/profile writes, credential disclosure and unrelated tool or resource access.

#### Scenario: Cancellation and reload
- **WHEN** a waiting task aborts and the runtime reloads or closes
- **THEN** old observers cannot revive/publish into a new run and no daily session/config or real bank is changed

### Requirement: Sequential truthful acceptance
Later stages SHALL use actual source/owner/service facts and keep missing receipt roles MISSING rather than fabricating operational proofs.

#### Scenario: Incomplete producer set
- **WHEN** only some actual receipt producers/public-key provenance are available
- **THEN** no experience receives current verified/trusted status or permission
