# First Arc Testnet Settlement

Status: **pending real credentials and funded wallets**. This document must not
claim a deployment or settlement until the hashes below come from Arc Testnet.

## Invariants proved by the flow

The test is successful only when the following sequence completes:

1. The deterministic Evidence Witness verifies all W01–W10 checks for a clearly
   labelled TEST evidence pack.
2. The Decision Agent emits `PAY_NOW` and the deterministic validator accepts
   the plan.
3. A canonical `decisionCommitmentHash` binds the decision, evidence, payment,
   and versioned chain context before signing.
4. The configured Witness signs the EIP-712 attestation. Raw test keys are
   refused in production; production must supply a managed
   `WitnessTypedDataSigner` implementation.
5. `ObligationVault` checks its immutable business binding, signer and rules
   versions, current vendor destination/version, amount cap, official Arc USDC,
   expiry, chain, vault, and replay keys.
6. Circle signs only the prepared vault call. Arc executes it.
7. Reconciliation compares the exact emitted operation, vendor, payee, amount,
   evidence root, decision commitment, and attestation hash.
8. The complete artifact is hashed separately as `finalReceiptHash`.

## Reproducible commands

Populate a private, ignored environment file from `.env.example`. Keep the
fixture identifiers and timestamps unchanged between the crash and retry runs.

```bash
source .env.arc-testnet.local
pnpm test
./scripts/deploy-arc-testnet.sh
```

The deployment script refuses a non-Arc-Testnet RPC or a non-official USDC
address. It deploys one vault for `VAULT_BUSINESS_ID_HASH`, registers the TEST
vendor destination, transfers `VAULT_INITIAL_FUNDING_MINOR` ERC-20 USDC from
the deployer into the vault, and writes public metadata to
`deployments/arc-testnet.json`.
The script also submits source verification to the Blockscout-compatible Arc
explorer by default and records `verificationStatus`; set `VERIFY_CONTRACT=NO`
only when diagnosing an explorer outage.

Before authorizing an obligation, prove that Circle can return a correctly
signed EIP-1559 transaction and Arc RPC accepts it. This broadcasts a zero-value
self-transaction and consumes only gas:

```bash
ARC_SMOKE_BROADCAST=YES pnpm --filter @euthyna/chain arc:smoke
```

Check chain ID, official token decimals/address, deployed bytecode, immutable
business binding, on-chain witness address, Circle wallet native gas balance,
and vault ERC-20 USDC balance:

```bash
pnpm --filter @euthyna/chain arc:preflight
```

Deliberately exit the process immediately after the Circle-signed transaction
is accepted by Arc RPC:

```bash
ARC_TESTNET_SETTLEMENT_ACK=YES \
ALLOW_TESTNET_RAW_WITNESS_KEY=YES \
FIRST_ARC_CRASH_AFTER_BROADCAST=YES \
pnpm --filter @euthyna/api arc:first-settlement
```

The expected exit code is `86`. Stdout contains the broadcast transaction hash,
and an ignored local checkpoint is synchronously written before termination.
Rerun the exact same fixture without crash mode. The runner waits for the
checkpointed transaction receipt, then the executor finds and validates the
existing event before Circle signing, so it does not sign or broadcast a second
payment:

```bash
ARC_TESTNET_SETTLEMENT_ACK=YES \
ALLOW_TESTNET_RAW_WITNESS_KEY=YES \
FIRST_ARC_CRASH_AFTER_BROADCAST=NO \
pnpm --filter @euthyna/api arc:first-settlement
```

The successful retry writes the public-safe evidence, checks, decision,
authorization, settlement, final receipt, and audit trail to
`artifacts/first-arc-settlement.json`.

## Public proof (fill only from successful output)

- Chain ID: pending
- Vault address: pending
- Deployment transaction: pending
- Deployment block: pending
- Contract verification status: pending
- Circle wallet address: pending
- Witness signer address/version: pending
- USDC token address: `0x3600000000000000000000000000000000000000`
- Settlement transaction: pending
- Settlement block: pending
- Obligation ID: pending
- Operation ID: pending
- Evidence root: pending
- Decision commitment hash: pending
- Attestation hash: pending
- Final receipt hash: pending
- Payee: pending
- Amount: pending
- Crash-retry result: pending

## Production signer and rotation

`WitnessAuthorizationService` depends on `WitnessTypedDataSigner`, not on a raw
key. `LocalPrivateKeyWitnessSigner` fails closed when `NODE_ENV=production`.
Production configuration must pin the expected public witness address and key
version, and a managed signer must return EIP-712 signatures without exposing
key material. Calling `setWitnessSigner` increments `witnessVersion`, which
invalidates every outstanding authorization created under the prior signer.
Rules and policy versions independently invalidate stale authorizations.

No command logs API keys, entity secrets, or private keys. There is no generic
signing HTTP endpoint.

Circle's current EVM signing guide uses the same transaction JSON fields as this
implementation (`nonce`, `to`, `value`, `gas`, EIP-1559 fee fields, and
`chainId`): <https://developers.circle.com/wallets/sign-tx-evm>.
