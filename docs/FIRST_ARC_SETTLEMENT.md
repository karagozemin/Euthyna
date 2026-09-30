# First Arc Testnet Settlement

Status: **completed on Arc Testnet on 2026-09-30**. The deployment and
settlement values below were captured from the successful Arc Testnet run.

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
Install [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry)
and ensure `arc-forge` and `arc-cast` are on `PATH`; standard Foundry cannot
simulate Arc's native-USDC precompile behavior.

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

Before authorizing an obligation, prove that Circle's managed Arc transaction
path can sign and broadcast the exact prepared calldata. This calls the official
USDC contract with a zero-amount transfer back to the Circle wallet and consumes
only gas:

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
pnpm --filter @euthyna/api build
ARC_TESTNET_SETTLEMENT_ACK=YES \
ALLOW_TESTNET_RAW_WITNESS_KEY=YES \
FIRST_ARC_CRASH_AFTER_BROADCAST=YES \
node apps/api/dist/first-arc-settlement.js
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
node apps/api/dist/first-arc-settlement.js
```

The successful retry writes the public-safe evidence, checks, decision,
authorization, settlement, final receipt, and audit trail to
`artifacts/first-arc-settlement.json`.

## Public proof

- Chain ID: `5042002`
- Vault address: `0x61322f6e21ec822cb220b145fb9184265a580b12`
- Deployment transaction: `0xddb87cc13660657fc6f4c20840c210a2d1a371b9ca64947619c56acab74e4b51`
- Deployment block: `64818417`
- Contract verification status: `verified`
- Circle wallet address: `0x66d6A96E97b531D7C9603668803B1750cd343eF1`
- Witness signer address/version: `0x07c0EF3d66F278Ff77663f6739DAA448eE5206af` / `1`
- USDC token address: `0x3600000000000000000000000000000000000000`
- Settlement transaction: `0xb386d3041613b028bc6aa88518e8a010b01b1c0eb59aca632da4eefc4fac6b42`
- Settlement block: `64819572`
- Obligation ID: `obl_arc_test_001`
- Obligation ID hash: `0x7aca9a1cd2c398263b2226937b7a8cd87963eaa4e545dbe977d7437e162cd910`
- Operation ID: `op_arc_test_001_release_1`
- Operation ID hash: `0x43708ead7ef24e9f70797b8e66bae029ba506e0c1a0ec487fa246054500891b3`
- Evidence root: `0x0358f0605038371dc683a0913ce99a2158866598ce1cf0d94cec84e651b05de4`
- Decision commitment hash: `0x9f95e48beff1e2494da9ba19fd9b282aa22f989cb253f99f851711481344f685`
- Attestation hash: `0x0d15a44772bbcca032a431f8279b7dae4d08c41dc3b950801d04a38bac9b140f`
- Final receipt hash: `0xe6e6445c09817d10ee9efad3ef5875fd2a401ad319242f9e91db3b42eb2d17de`
- Payee: `0x8273b9ca852F95467BD060A9106F0998452f55d3`
- Amount: `1000` minor units (`0.001 USDC`)
- Settlement result: `RECONCILED`
- Crash-retry result: the first process exited with code `86` after broadcast;
  retry reconciled the same transaction without signing or broadcasting another
  payment. Duplicate payment amount: `0`.

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

Circle's raw transaction signing endpoint supports generic `EVM` and
`EVM-TESTNET` wallets, not chain-specific `ARC-TESTNET` wallets. This flow uses
Circle's managed contract-execution endpoint with raw `callData`, a deterministic
idempotency key, and Circle transaction-ID/tx-hash validation:
<https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-contract-execution-transaction>.
