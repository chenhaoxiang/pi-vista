# @pi-vista/evidence

Explicit authority-bound gate/test/guard verification. Ed25519 public-key pins,
canonical closed receipts, SHA-256 content digests, required gate/test checks,
run/repo/source/policy/environment bindings and bounded freshness. No implicit
owner integration, private signing key, default artifact reader or network client.

The separate opt-in `@pi-vista/evidence/files` export supplies bounded private
read-only POSIX `EvidenceSource` callbacks for exact canonical v1 files. The root
verifier is unchanged and does not eagerly import this addon. Transport parsing
is not authentication or permission; actual compatible owner producers and
public-key provenance remain **MISSING / not accepted**. See the
[receipt file guide](../../docs/receipt-files.md) for explicit config, encoding,
unsupported legacy material, cancellation and point-in-time host limitations.

See [the evidence guide](../../docs/authoritative-evidence.md) for the public
contract, opaque proof provenance, CheckRegistry probes and limitations.
