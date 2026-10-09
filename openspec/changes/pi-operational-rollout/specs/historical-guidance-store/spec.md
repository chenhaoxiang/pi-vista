## ADDED Requirements

### Requirement: Guidance persistence shall be explicit and separate
The guidance addon SHALL require explicit local-guidance mode, origin, actual bank mapping, optional host-provided credential and existing private journal. Import/construction SHALL perform no filesystem/network/bank/key/credential discovery. It SHALL NOT weaken original signed archive/store or root Learning admission.

#### Scenario: A local historical observation is prepared
- **WHEN** safe raw observation metadata is supplied
- **THEN** a pure canonical historical-guidance document MAY be prepared
- **AND** current verification SHALL be not-checked, authorization none and executable false
- **AND** derived failure analysis SHALL NOT be substituted for raw failure observations

#### Scenario: A higher-trust or unsafe object is supplied
- **WHEN** signature/current-proof/status flags, hostile descriptors, unsafe labels or unknown schema/fields are supplied
- **THEN** it SHALL refuse without normalization, callbacks or I/O

### Requirement: Store acceptance shall require exact original bytes
The store SHALL bind canonical target/alias/actual bank/request/content/identity, issue only fixed bounded one-item retain and independent original GET, and require full canonical byte-exact original readback. Fact text, rank, ack flags, hash echoes, null/partial/substituted originals SHALL NOT establish persistence or current trust.

#### Scenario: Backend stores and returns the original
- **WHEN** explicit retain succeeds and independently read original_text matches the whole safe target-bound document
- **THEN** a guidance receipt/readback MAY be returned
- **AND** it SHALL remain historical not-checked/non-executing

#### Scenario: Bank is absent
- **WHEN** existing-bank preflight cannot confirm the configured bank
- **THEN** it SHALL issue no retain/recall or library-driven provisioning
- **AND** an external administrator delete race SHALL remain a documented non-CAS limit

### Requirement: Uncertainty shall never authorize repeat retain
Durable exclusive local intent and directory sync SHALL precede retain. Only first creator with definitive original404 MAY retain once. Existing/uncertain/corrupt claims SHALL NOT reset, delete, take over or authorize another POST. Reconciliation SHALL be remote-read-only, confirm only exact original bytes and never restore current proof.

#### Scenario: Client restarts after commit/lost acknowledgement
- **WHEN** it reopens the same target/private journal
- **THEN** it SHALL read/reconcile exact persisted guidance without a second retain
- **AND** serialized history SHALL NOT create a current verified handle

#### Scenario: Claim exists but original is absent
- **WHEN** the prior attempt cannot be confirmed
- **THEN** it SHALL return fixed uncertainty/failure and SHALL NOT reissue retain

### Requirement: Recall shall return bounded own-target references
Recall SHALL use only safe task/binding labels and fixed scoped tags, reject malformed responses, deduplicate/sort/cap own-target refs, and never promote extracted fact text or returned flags into authenticated history.

#### Scenario: Foreign or missing document references are returned
- **WHEN** recall results include unrelated/null/foreign namespaces
- **THEN** those references SHALL be excluded
- **AND** malformed own-namespace references SHALL fail the whole request instead of partial success

### Requirement: Actual service trial shall remain scoped
Ordinary tests/CI SHALL use synthetic loopback fixtures. Actual trial SHALL require explicit effectful admission, exact source pin, approved endpoint/bank and trusted credential source, bounded synthetic guidance writes and independent restarted client readback/failure evidence. Actual installed fingerprints SHALL be recorded without claiming byte equality to the original upstream contract pin.

#### Scenario: Owner approves current localhost deployment
- **WHEN** the approved dedicated bank and accepted deployment fingerprints are verified
- **THEN** synthetic minimized guidance-only persistence MAY be tested
- **AND** main-bank acceptance writes, service restart, deletion, global configuration/model changes or signed provenance SHALL NOT be inferred or performed
