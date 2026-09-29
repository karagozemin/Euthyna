# PRD implementation status

The authoritative product specification is `Euthyna_Full_PRD_Tameion_2026.docx`. This file records implementation order; it does not replace or amend the PRD.

## Runtime trust boundaries

1. Evidence adapters normalize source data and retain provenance. Extracted fields remain untrusted.
2. The Evidence Witness runs deterministic W01–W10 checks and is the only service allowed to produce a `VERIFIED` verdict.
3. The Decision Agent sees only verified obligations and proposes economic timing or prioritization.
4. A deterministic plan validator prevents amount/payee mutation and reserve or policy violations.
5. The witness attestation binds the exact obligation, evidence root, payee, amount, vendor version, policy version, receipt hash, token, and expiry.
6. `ObligationVault` is final authority and releases an obligation at most once.
7. Arc/Circle executes and the receipt records finality. Optional simulation is execution safety, never business truth.

## MVP order and acceptance mapping

| Order | Deliverable | PRD mapping | Status |
| --- | --- | --- | --- |
| 1 | Workspace and canonical schemas | FR-001–005, NFR money rules | Implemented |
| 2 | Evidence fingerprints, roots, W01–W10 | FR-003–008, AC-03–06 | Implemented; persistence pending |
| 3 | Database, audit events, orchestration API | §§18–19, FR-013–016 | Schema, transactional local repository, audit, and route surface implemented |
| 4 | Decision Agent and plan validator | FR-009–010, AC-07–08 | Implemented baseline |
| 5 | Attestation and `ObligationVault` | FR-011–012, AC-09–10 | Implemented baseline |
| 6 | Arc/Circle execution and reconciliation | §13, AC-11 | Circle adapter + local end-to-end reconciliation implemented; live execution blocked on environment configuration |
| 7 | Canonical decision receipt | §22, AC-12 | Implemented baseline |
| 8 | Reviewer dashboard and four scenarios | §§20, 26, AC-13–14 | Not started |
| 9 | Full invariant/adversarial/deployment pass | §27, AC-15–18 | Not started |

## Normative execution order

Evidence Intake → Normalization → Evidence Witness → VERIFIED Obligations → Decision Agent → Deterministic Plan Validator → Witness Authorization → ObligationVault → Preflight/Simulation → Circle Signing → Arc Broadcast/Reconciliation → Decision Receipt.

## Known external inputs

- Arc network/RPC, explorer, chain ID, and USDC contract address per environment.
- Circle wallet mode, credentials, and signing configuration.
- Witness and owner key custody configuration.
- Database and private object-storage configuration.
- At least one consented real-business evidence pack, redaction policy, and REAL/TEST classification.
- Aomi availability is optional and cannot block settlement.

## Locked implementation decisions

- Monetary values cross service boundaries as base-10 integer strings plus explicit token decimals. Runtime arithmetic uses `bigint`; floating point is forbidden.
- Arc native USDC gas units (18 decimals) and the USDC ERC-20 interface used for vault transfers (6 decimals) are distinct configured representations and must never be mixed.
- Evidence and receipt commitments use canonical JSON and explicit hash algorithm labels.
- W01–W10 always run and persist check-level results. A failed check cannot be hidden by an overall model confidence score.
- If multiple checks fail, a deterministic `REJECT` reason takes precedence over `HOLD`; order within a disposition follows W01–W10.
- Planning occurs after witness verification, as required by §§11 and 15, even though the reference figure is visually arranged with the agent first.
