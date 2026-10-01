# REAL Pilot Operator Runbook

This is the smallest supported path for evaluating 1–3 real business
obligations. It is operator-assisted; local operation remains the recommended
path for sensitive material. The hosted Vercel/Render path is a controlled
evaluation surface, not a hardened customer portal or production document
store. Neither path turns demo fixtures into traction.

## Privacy boundary

All private pilot material lives under `.euthyna/pilots/`, which is gitignored.
The initializer creates directories with mode `700` and private files with mode
`600`. Evaluation refuses evidence files that are symlinks, outside the pilot's
`evidence/` directory, larger than 25 MiB, or readable by group/other users.

The only publishable file is
`artifacts/pilots/public-index.json`. It is generated from a fixed allowlist and
contains aliases, consented amount disclosure, evidence classes, Witness
verdict/reason, Agent decision, settlement state, and optionally an evidence
root or transaction hash. It never contains source documents, private IDs,
legal names, invoice numbers, payout addresses, consent references, file paths,
or feedback notes.

GitHub Pages deploys only `apps/web/dist`. Private pilot directories cannot be
part of that bundle.

## 1. Initialize a private record

### Local operator UI

The UI wraps the same private evaluator and is the recommended interactive
path:

```sh
pnpm pilot:ui
```

Open `http://localhost:5173/pilot` (use the alternate port printed by Vite if
5173 is occupied). The local API listens only on `127.0.0.1:8787`. The wizard
collects private business and obligation data, source documents, independent
consent references and economic context, then writes the private record and
runs the unchanged Witness and Agent. It never represents settlement
eligibility as a submitted transaction.

The Vercel deployment proxies `/pilot-api/*` to the Render pilot service. That
hosted service currently lacks authentication, rate limiting, malware scanning,
and durable private storage; do not upload sensitive production documents until
those controls exist.

The CLI path below remains available for manual/operator-assisted intake.

Choose a private operator ID that does not identify the business publicly:

```sh
pnpm pilot init --pilot-id pilot_<private-id>
```

This creates:

```text
.euthyna/pilots/pilot_<private-id>/
├── README.private.txt
├── manifest.private.json
├── feedback.private.json
└── evidence/
```

Place the invoice, agreement/PO/contract, delivery/milestone/usage proof, and
any separate payment instruction under `evidence/`. Then restrict every source:

```sh
chmod 600 .euthyna/pilots/pilot_<private-id>/evidence/*
```

Do not rename or move the directory outside `.euthyna`.

## 2. Complete the private manifest

Fill `manifest.private.json` with operator-confirmed values. The manifest is
intentionally invalid until completed.

Required groups:

- private business and vendor identifiers/names;
- distinct non-identifying public aliases;
- obligation facts and verified payout destination, if one exists;
- one entry per private evidence file with normalized fields;
- current business balance, reserve, approval threshold, and expected inflows;
- three independent consent records;
- an explicit public-disclosure policy.

Keep `classification` exactly `REAL`. The minimal path currently accepts
6-decimal USDC obligations only.

Consent is not implied:

- `processEvidence.granted` permits private local evaluation;
- `publicRedactedMetrics.granted` permits inclusion in aggregate/public proof;
- `settlement.granted` permits only its stated `ARC_TESTNET` or `REAL_USDC`
  scope. Use `NONE` when not granted.

The operator reference is private. It can point to a signed form, email, or
other consent record but must not contain that document itself.

When a normalized field is unknown, keep it unresolved or list it in
`ambiguousFields`. Do not infer or fabricate evidence to obtain `VERIFIED`.

## 3. Evaluate Witness and Agent

```sh
pnpm pilot evaluate --pilot-id pilot_<private-id>
```

The command:

1. validates classification, consent, cross-record IDs and USDC units;
2. hashes the private file bytes without publishing them;
3. loads prior private pilot outcomes for semantic duplicate detection;
4. runs the unchanged Evidence Witness W01–W10;
5. calls the bounded Decision Agent only for `VERIFIED` obligations;
6. validates the Agent result against amount, payee, currency, reserve and
   approval constraints;
7. writes `result.private.json` with mode `600`.

A missing agreement or delivery proof must produce a real `HOLD`. A duplicate
or already-settled obligation may produce `REJECT`. These are valid pilot
outcomes and must not be edited into success.

Evaluation refuses to overwrite an existing result. Preserve it as an audit
record; create a new pilot ID for materially revised evidence.

## 4. Capture business feedback

After showing the result to the business, complete `feedback.private.json`:

- `witnessAgreement`: `YES`, `NO`, `PARTIAL`, or `NOT_ASKED`;
- `agentAgreement`: the same scale;
- `preferredAction`: what they would have done;
- `frictionNotesPrivate`: factual workflow friction;
- `wouldUseAgain`: `YES`, `NO`, `MAYBE`, or `NOT_ASKED`.

Use `PENDING` until asked and `DECLINED` if the business declines feedback.
Never manufacture an answer. Validate the capture with:

```sh
pnpm pilot feedback --pilot-id pilot_<private-id>
```

Public human-agreement rate counts only observed `YES`/`NO`/`PARTIAL`
responses. `NOT_ASKED`, pending, and declined feedback remain `N/A`.
Private friction notes are never published.

## 5. Optional settlement

Evaluation reports `settlementEligible: true` only when all of these hold:

- processing and scoped settlement consent are granted;
- Witness verdict is `VERIFIED`;
- the validated Agent action is `PAY_NOW`;
- no reserve, payee, amount, currency, or approval constraint failed.

Eligibility is not authorization to improvise a transfer. Use the existing
Witness authorization, vault preflight, Circle execution and reconciliation
path against a vault bound to that real business. Never reuse the public TEST
fixture's business binding for a different business.

After a reconciled, consented execution, create
`settlement.private.json` from the executor result with this shape:

```json
{
  "schemaVersion": "1",
  "classification": "REAL",
  "pilotId": "pilot_<private-id>",
  "scope": "ARC_TESTNET",
  "chainId": 5042002,
  "network": "Arc Testnet",
  "txHash": "0x...",
  "blockNumber": "ACTUAL_BLOCK_NUMBER",
  "status": "RECONCILED",
  "amountMinor": "ACTUAL_MINOR_UNITS",
  "evidenceRoot": "0x...",
  "autonomous": true,
  "finalizedAt": "2026-01-01T00:00:00.000Z"
}
```

Replace every example value from the actual reconciled output, set mode `600`,
then bind it to the private result:

```sh
pnpm pilot record-settlement --pilot-id pilot_<private-id>
```

The command refuses missing consent, non-eligible decisions, scope mismatch,
amount mismatch, evidence-root mismatch, or an autonomous settlement without
`PAY_NOW`. It does not broadcast a transaction itself.

## 6. Generate public-safe metrics and proof

```sh
pnpm pilot publish
```

The publisher scans private completed records but includes only records with
explicit redacted-metrics consent. It regenerates the entire public index,
computes truthful aggregates, and fails if a forbidden private value appears in
the serialized output.

Before committing after the first pilot:

```sh
git diff -- artifacts/pilots/public-index.json
pnpm typecheck
pnpm test
pnpm build
```

Inspect the diff with the business's disclosure choices in hand. Commit only
the public index and public documentation/UI changes. Never use `git add -f` on
anything under `.euthyna`.

The reviewer metrics page automatically renders consented REAL cards and keeps
the deterministic TEST dataset separate. If no observations exist, values stay
`0` or `N/A`.

## Current traction status

No REAL pilot record has been published. The committed public index truthfully
contains zero businesses, zero obligations, zero volume, and no feedback
observations.
