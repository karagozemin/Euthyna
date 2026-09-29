# Euthyna

**Agent decides → Euthyna proves the obligation → contract authorizes → Arc settles.**

Euthyna is a proof-of-obligation accounts-payable agent. A model may recommend when to pay a legitimate obligation, but deterministic evidence checks and a one-time on-chain authorization decide whether USDC can move.

## Normative execution order

```text
Evidence Intake → Normalization → Evidence Witness → VERIFIED Obligations
→ Decision Agent → Deterministic Plan Validator → Witness Authorization
→ ObligationVault → Preflight/Simulation → Circle Signing
→ Arc Broadcast/Reconciliation → Decision Receipt
```

The Evidence Witness establishes business truth. The Decision Agent makes economic judgments only between already verified obligations. The contract is payment authority; the execution layer is transaction correctness.

This repository is under active MVP construction from the authoritative product requirements in `Euthyna_Full_PRD_Tameion_2026.docx`.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The local vertical slice covers ingestion through an immutable receipt, including crash-safe reconciliation. Raw model output is never an authorization input.

## Arc Testnet milestone

The hardened Arc path, reproducible deployment script, Circle signing smoke test,
funding preflight, deliberate post-broadcast crash mode, and public proof format
are documented in [`docs/FIRST_ARC_SETTLEMENT.md`](docs/FIRST_ARC_SETTLEMENT.md).
No placeholder deployment or transaction hashes are committed: the proof file
is populated only from a successful Arc Testnet run.
