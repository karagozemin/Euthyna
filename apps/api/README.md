# API application

Implemented route surface: authenticated orchestration boundaries for `/v1/businesses`, vendors and destination verification, evidence, obligations, witness verification, plans, attestations, simulation, settlement submission, reconciliation, receipts, metrics, and feedback.

This app must call the package boundaries; it may not assign `VERIFIED`, sign an attestation from raw model output, or bypass `ObligationVault`. Persistence and transaction boundaries will use `@euthyna/db`.
