# Witness authorization

Witness authorization is issued only when a stored Witness result is `VERIFIED` and the deterministic plan validator returns `valid: true`. A HOLD/REJECT or mechanically invalid plan cannot be signed.

## EIP-712 domain

- name: `Euthyna ObligationVault`
- version: `1`
- `chainId`: target Arc chain
- `verifyingContract`: deployed `ObligationVault`

## WitnessAttestation

```solidity
WitnessAttestation(
  bytes32 obligationId,
  bytes32 operationId,
  bytes32 businessIdHash,
  bytes32 vendorIdHash,
  address payee,
  address token,
  uint256 amount,
  bytes32 evidenceRoot,
  bytes32 receiptHash,
  uint64 vendorVersion,
  uint64 policyVersion,
  uint64 witnessVersion,
  uint64 rulesVersion,
  uint64 validUntil,
  uint256 chainId,
  address verifyingContract
)
```

The explicit chain and vault fields are checked on-chain in addition to EIP-712 domain separation. `obligationId` and `operationId` have independent replay guards. Vendor, policy, witness-signer, or rules changes make older attestations stale.

The attestation binds the canonical vendor identity (`vendorIdHash`) separately from the current verified payout destination (`payee`). It also binds the exact evidence set, token, integer amount, receipt commitment, and expiry. Substitution of any field invalidates the signature.

The local private-key signer and deterministic executor are CI-only and reject production configuration. Circle custody remains the transaction-signing boundary for Arc deployment; witness custody must be a separate rotatable key service.

