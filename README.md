# Euthyna

**Agent decides → Euthyna proves the obligation → contract authorizes → Arc settles.**

Euthyna is a proof-of-obligation accounts-payable agent. A model may recommend when to pay a legitimate obligation, but deterministic evidence checks and a one-time on-chain authorization decide whether USDC can move.

This repository is under active MVP construction from the authoritative product requirements in `Euthyna_Full_PRD_Tameion_2026.docx`.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The first implemented boundary is the deterministic Evidence Witness. It runs W01–W10 and emits inspectable `VERIFIED`, `HOLD`, or `REJECT` results. Raw model output is never an authorization input.

