# Evidence model

The Evidence Witness establishes business truth; it does not make liquidity decisions and does not hold funds.

Vendor identity and payout destination are separate records. A vendor begins in `PENDING_ONBOARDING`; its first address remains proposed until explicit verification. Once a verified destination exists, an unseen address creates a `DESTINATION_CHANGE`, preserves the old verified record, and places the vendor and affected obligations on HOLD.

## Authority by class

- An invoice is a commercial claim and is never sufficient alone.
- An agreement defines the expected vendor, scope, price, terms, and release condition.
- Delivery or acceptance proves counter-performance.
- The versioned vendor master defines the current verified payout destination.
- Payment instructions inside an invoice or email are untrusted when they conflict with the vendor master.
- A recorded, versioned human attestation can resolve an allowed exception.

## Deterministic checks

`@euthyna/witness` runs W01–W10 on every evaluation. All check results are retained even when an earlier check fails. `REJECT` takes deterministic precedence over `HOLD`; checks are ordered W01–W10 within a disposition.

Model extraction is nullable and includes provenance. Missing or ambiguous required payment fields produce W10 `AMBIGUOUS_FIELD`; the verifier never guesses. Duplicate identity combines artifact hashes, the canonical business/vendor/invoice/date/amount/currency fingerprint, near-duplicate line-item evidence, and prior settlement state.

The evidence root commits to sorted artifact identifiers, types, issuer, receipt time, raw and normalized hashes, relevant identifiers, relationships, provenance metadata, parser versions, and all deterministic check results. Raw source documents remain off-chain.
