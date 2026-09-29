# Required demo scenarios

All synthetic/adversarial records must be labeled `TEST`; they do not count as traction.

## A — Valid real obligation

Invoice + active agreement + delivery acceptance + current vendor destination pass W01–W10. A validated plan produces a short-lived attestation, `ObligationVault` releases USDC once, and the receipt links the Arc transaction. A real flow remains blocked until a consented pilot evidence pack and funded Circle-controlled Arc wallet are configured.

## B — Agentic prioritization

Three `VERIFIED` obligations compete for cash: a critical vendor due now, an early-pay discount, and a lower-priority invoice. The Decision Agent pays the first two and schedules the third after a sufficiently confident inflow while preserving the reserve floor. The validator independently recomputes the mechanical constraints.

## C — Duplicate obligation

A second file with the same canonical business obligation fingerprint reaches W06 `REJECT: DUPLICATE_OBLIGATION`. No attestation or transaction is prepared. If already settled, W08 also records `ALREADY_SETTLED` and chain state remains authoritative.

## D — Vendor payout destination change

An otherwise consistent invoice proposes a destination different from the current versioned vendor master. W07 returns `HOLD: DESTINATION_CHANGED`; owner re-verification must create a new vendor version, which invalidates every old attestation.

