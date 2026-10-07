## ADDED Requirements

### Requirement: Explicit original-document transport
The adapter SHALL be exposed only through the explicit `@pi-vista/learning/hindsight` addon subpath, without transitive I/O imports from the unchanged learning root graph. It SHALL use only explicitly configured endpoint/bank aliases and the pinned Hindsight 0.10.2 retain, original-document and recall contracts. It SHALL preserve the exact closed safe learning/archive request, refuse unknown/raw content, and verify original-text readback instead of accepting acknowledgements, generated facts or status flags as persistence proof.

#### Scenario: Exact confirmed round trip
- **WHEN** a current learning library invokes the configured sink with an exact confirmed safe request
- **THEN** the adapter submits at most one synchronous retain item and returns a receipt only after independently reading and matching the original document

#### Scenario: Candidate recall is not authority
- **WHEN** semantic recall returns references and generated text
- **THEN** the adapter projects only bounded scoped original-document references and the unchanged portable library independently authenticates original signed history

### Requirement: Durable write-attempt protection
The adapter SHALL persist an exclusive durable no-follow intent before any remote write. Cooperating processes SHALL share the explicit private local POSIX journal root and target scope. Existing, partial, corrupt or uncertain claims SHALL never authorize a second retain, a lease reset or deletion.

#### Scenario: Lost acknowledgement or crash
- **WHEN** a writer terminates or loses the retain acknowledgement after recording its intent
- **THEN** subsequent attempts only read the deterministic original document, accept an exact observed match or refuse uncertainty, and do not send another retain

#### Scenario: Concurrent writers
- **WHEN** two fresh processes attempt the same request under one journal scope
- **THEN** only the exclusive intent creator may send retain and neither process infers authority from the journal or completion flag

### Requirement: Private bounded and non-authorizing behavior
The adapter SHALL perform no default credential/environment discovery or activation. It SHALL reject redirects, unbounded bodies, ambiguous scope and unsafe inputs; use fixed errors; and keep configured credentials/endpoints out of protocol data, archives and journal records. Explicit loopback HTTP MAY be enabled for local tests. Source tests SHALL use synthetic HTTP/services only.

#### Scenario: Historical import after restart
- **WHEN** a separate process reads a matched original signed archive
- **THEN** historical authenticity remains distinct from current proof, imported state is observed-only and fresh owner evidence is still required

#### Scenario: Transport rejection
- **WHEN** authentication fails, a response is malformed/oversized, the target redirects or readback mismatches
- **THEN** no success, current trusted handle, permission or automatic retry is produced
