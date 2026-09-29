# API application

Planned PRD surface: authenticated orchestration for `/v1/businesses`, vendors, evidence, obligations, witness verification, plans, attestations, settlement submission, receipts, metrics, and feedback.

This app must call the package boundaries; it may not assign `VERIFIED`, sign an attestation from raw model output, or bypass `ObligationVault`. Persistence and transaction boundaries will use `@euthyna/db`.

