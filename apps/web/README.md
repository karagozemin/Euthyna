<p align="center">
  <img src="../../euthyna.png" alt="Euthyna" width="160">
</p>

# Euthyna reviewer application

The public reviewer surface explains Euthyna without credentials and replays four
deterministic scenarios. All bundled records are labelled `TEST`; the metrics
view keeps real pilot activity separate and currently reports zero REAL records.

```sh
pnpm --filter @euthyna/web dev
pnpm --filter @euthyna/web test
pnpm --filter @euthyna/web build
```

Routes:

- `/demo` — thesis, trust path, scenarios, obligation feed and Arc proof
- `/demo/valid` — the real first Arc Testnet settlement fixture
- `/demo/prioritization` — constrained-cash Agent decision
- `/demo/duplicate` — semantic duplicate rejected before the Agent
- `/demo/destination-change` — changed payout destination held before signing
- `/obligations/:id` — reviewer-friendly decision detail
- `/metrics` — explicitly separated TEST and REAL metrics
- `/pilot` — private/local REAL intake, Witness and Agent workflow

The production bundle includes only public-safe summaries and hashes. It does
not embed environment files, private documents, signing material or Circle
credentials.

Run the private pilot UI and localhost-only API together from the repository
root with `pnpm pilot:ui`. The hosted route fails closed when that private
runtime is absent.
