import { WitnessAttestationSchema, type WitnessAttestation } from "@euthyna/domain";
import { encodeFunctionData, hashTypedData, type Address, type Hex } from "viem";

export const OBLIGATION_VAULT_ABI = [
  {
    type: "function",
    name: "settled",
    stateMutability: "view",
    inputs: [{ name: "obligationId", type: "bytes32" }],
    outputs: [{ name: "isSettled", type: "bool" }],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
          { name: "obligationId", type: "bytes32" },
          { name: "businessIdHash", type: "bytes32" },
          { name: "vendorIdHash", type: "bytes32" },
          { name: "payee", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "evidenceRoot", type: "bytes32" },
          { name: "receiptHash", type: "bytes32" },
          { name: "vendorVersion", type: "uint64" },
          { name: "policyVersion", type: "uint64" },
          { name: "validUntil", type: "uint64" },
        ],
      },
      { name: "witnessSignature", type: "bytes" },
      { name: "ownerApproval", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "ObligationSettled",
    anonymous: false,
    inputs: [
      { name: "obligationId", type: "bytes32", indexed: true },
      { name: "vendorIdHash", type: "bytes32", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "evidenceRoot", type: "bytes32", indexed: false },
      { name: "receiptHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const WITNESS_TYPES = {
  WitnessAttestation: [
    { name: "obligationId", type: "bytes32" },
    { name: "businessIdHash", type: "bytes32" },
    { name: "vendorIdHash", type: "bytes32" },
    { name: "payee", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "evidenceRoot", type: "bytes32" },
    { name: "receiptHash", type: "bytes32" },
    { name: "vendorVersion", type: "uint64" },
    { name: "policyVersion", type: "uint64" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export function toContractAttestation(raw: WitnessAttestation) {
  const value = WitnessAttestationSchema.parse(raw);
  return {
    obligationId: value.obligationId as Hex,
    businessIdHash: value.businessIdHash as Hex,
    vendorIdHash: value.vendorIdHash as Hex,
    payee: value.payee as Address,
    token: value.token as Address,
    amount: BigInt(value.amountMinor),
    evidenceRoot: value.evidenceRoot as Hex,
    receiptHash: value.receiptHash as Hex,
    vendorVersion: BigInt(value.vendorVersion),
    policyVersion: BigInt(value.policyVersion),
    validUntil: BigInt(value.validUntilUnix),
  };
}

export function hashWitnessAttestation(
  chainId: number,
  vaultAddress: Address,
  attestation: WitnessAttestation,
): Hex {
  return hashTypedData({
    domain: {
      name: "Euthyna ObligationVault",
      version: "1",
      chainId,
      verifyingContract: vaultAddress,
    },
    types: WITNESS_TYPES,
    primaryType: "WitnessAttestation",
    message: toContractAttestation(attestation),
  });
}

export function encodeReleaseCall(
  attestation: WitnessAttestation,
  witnessSignature: Hex,
  ownerApproval: Hex = "0x",
): Hex {
  return encodeFunctionData({
    abi: OBLIGATION_VAULT_ABI,
    functionName: "release",
    args: [toContractAttestation(attestation), witnessSignature, ownerApproval],
  });
}
