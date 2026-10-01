# API application

Implemented route surface: authenticated orchestration boundaries for `/v1/businesses`, vendors and destination verification, evidence, obligations, witness verification, plans, attestations, simulation, settlement submission, reconciliation, receipts, metrics, and feedback.

This app must call the package boundaries; it may not assign `VERIFIED`, sign an attestation from raw model output, or bypass `ObligationVault`. Persistence and transaction boundaries will use `@euthyna/db`.

The private REAL-pilot operator server is a separate entrypoint:

```sh
pnpm --filter @euthyna/api pilot:server
```

Without `PORT`, it binds to `127.0.0.1:8787` for local operator use. In a hosted
environment such as Render, `PORT` makes it listen on `0.0.0.0`. It writes
uploads only under the ignored private pilot root, runs the existing
Witness/Agent implementation, and captures private feedback. It does not expose
signing credentials or broadcast a settlement.

The current hosted entrypoint has no authentication, rate limiting, or durable
private object storage. Treat it as a controlled evaluation surface, not a
production document-custody service.
