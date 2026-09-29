# Threat model

## Locked invariants

1. A model recommendation cannot create evidence truth.
2. Only a `VERIFIED` obligation may enter an executable plan.
3. The plan validator cannot increase an amount, change a payee, breach reserve, or skip required approval.
4. A witness attestation binds the exact obligation, business, vendor, payee, token, amount, evidence root, receipt hash, vendor version, policy version, and expiry.
5. `ObligationVault` releases an obligation ID at most once.
6. A destination or policy change invalidates stale attestations.
7. Ambiguity and integration failure fail closed.

## Principal threats and controls

| Threat | Control |
| --- | --- |
| Prompt injection in a document | Document text is data only; deterministic checks own the verdict. |
| Vendor email compromise | Versioned vendor master; changed destination HOLD; out-of-band re-verification. |
| Duplicate upload or worker retry | Semantic fingerprint plus on-chain single-use obligation ID and chain reconciliation. |
| Compromised planner/model | VERIFIED-only inputs plus deterministic plan validator and hard contract policy. |
| API mutation after verification | Exact EIP-712 binding and contract revalidation. |
| Stale authorization | Vendor/policy versions, signer rotation, and short expiry. |
| Parser error | Per-field provenance; unresolved required fields HOLD. |
| Wrong token units | Explicit token decimals; Arc native gas (18) is distinct from Arc USDC ERC-20 transfers (6). |
| Signing-key exposure | Circle/witness secrets are server-only and never enter prompts, browser logs, or public telemetry. |

## Residual MVP risk

The witness signer is a high-trust service. Mitigations are short expiry, rotation, pause, low vault balances/caps, and append-only monitoring. Quorum witnesses and hardware-backed isolation are post-MVP work.

