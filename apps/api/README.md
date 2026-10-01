# API application

Implemented route surface: authenticated orchestration boundaries for `/v1/businesses`, vendors and destination verification, evidence, obligations, witness verification, plans, attestations, simulation, settlement submission, reconciliation, receipts, metrics, and feedback.

This app must call the package boundaries; it may not assign `VERIFIED`, sign an attestation from raw model output, or bypass `ObligationVault`. Persistence and transaction boundaries will use `@euthyna/db`.

The private REAL-pilot operator server is a separate localhost-only entrypoint:

```sh
pnpm --filter @euthyna/api pilot:server
```

It binds to `127.0.0.1:8787`, writes uploads only under the ignored private
pilot root, runs the existing Witness/Agent implementation, and captures
private feedback. It does not expose signing credentials or broadcast a
settlement.
