import {
  PlanValidationResultSchema,
  WitnessResultSchema,
  type PlanValidationResult,
  type WitnessAttestation,
  type WitnessResult,
} from "@euthyna/domain";
import {
  WITNESS_TYPES,
  hashWitnessAttestation,
  toContractAttestation,
} from "@euthyna/chain";
import {
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface AuthorizationPaymentMeaning {
  operationId: string;
  businessId: string;
  vendorId: string;
  payee: Address;
  token: Address;
  amountMinor: string;
  decisionCommitmentHash: Hex;
  validUntilUnix: string;
  chainId: number;
  verifyingContract: Address;
  witnessVersion: number;
  rulesVersion: number;
}

export interface WitnessTypedDataSigner {
  readonly address: Address;
  sign(attestation: WitnessAttestation): Promise<Hex>;
}

export interface IssuedWitnessAuthorization {
  attestation: WitnessAttestation;
  attestationHash: Hex;
  signature: Hex;
  signer: Address;
}

export class WitnessAuthorizationService {
  constructor(private readonly signer: WitnessTypedDataSigner) {}

  async issue(
    rawWitness: WitnessResult,
    rawValidation: PlanValidationResult,
    meaning: AuthorizationPaymentMeaning,
  ): Promise<IssuedWitnessAuthorization> {
    const witness = WitnessResultSchema.parse(rawWitness);
    const validation = PlanValidationResultSchema.parse(rawValidation);
    if (witness.verdict !== "VERIFIED") {
      throw new Error(`Cannot authorize witness verdict ${witness.verdict}`);
    }
    if (!validation.valid) {
      throw new Error("Cannot authorize a plan that failed deterministic validation");
    }
    if (!/^(0|[1-9][0-9]*)$/.test(meaning.amountMinor) || BigInt(meaning.amountMinor) <= 0n) {
      throw new Error("Authorization amount must be a positive integer base-unit string");
    }
    if (BigInt(meaning.validUntilUnix) <= BigInt(Math.floor(Date.now() / 1_000))) {
      throw new Error("Witness authorization expiry must be in the future");
    }
    const attestation: WitnessAttestation = {
      obligationId: hashIdentifier(witness.obligationId),
      operationId: hashIdentifier(meaning.operationId),
      businessIdHash: hashIdentifier(meaning.businessId),
      vendorIdHash: hashIdentifier(meaning.vendorId),
      payee: meaning.payee,
      token: meaning.token,
      amountMinor: meaning.amountMinor,
      evidenceRoot: witness.evidenceRoot,
      decisionCommitmentHash: meaning.decisionCommitmentHash,
      vendorVersion: witness.vendorVersion,
      policyVersion: witness.policyVersion,
      witnessVersion: meaning.witnessVersion,
      rulesVersion: meaning.rulesVersion,
      validUntilUnix: meaning.validUntilUnix,
      chainId: meaning.chainId.toString(),
      verifyingContract: meaning.verifyingContract,
    };
    const signature = await this.signer.sign(attestation);
    return {
      attestation,
      attestationHash: hashWitnessAttestation(
        meaning.chainId,
        meaning.verifyingContract,
        attestation,
      ),
      signature,
      signer: this.signer.address,
    };
  }
}

export class LocalPrivateKeyWitnessSigner implements WitnessTypedDataSigner {
  private readonly account;
  readonly address: Address;

  constructor(
    private readonly privateKey: Hex,
    private readonly chainId: number,
    private readonly verifyingContract: Address,
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Local private-key witness signer is forbidden in production");
    }
    this.account = privateKeyToAccount(privateKey);
    this.address = this.account.address;
  }

  async sign(attestation: WitnessAttestation): Promise<Hex> {
    if (
      attestation.chainId !== this.chainId.toString() ||
      attestation.verifyingContract.toLowerCase() !== this.verifyingContract.toLowerCase()
    ) {
      throw new Error("Signer context does not match attestation chain/vault");
    }
    return this.account.signTypedData({
      domain: {
        name: "Euthyna ObligationVault",
        version: "1",
        chainId: this.chainId,
        verifyingContract: this.verifyingContract,
      },
      types: WITNESS_TYPES,
      primaryType: "WitnessAttestation",
      message: toContractAttestation(attestation),
    });
  }
}

function hashIdentifier(value: string): Hex {
  if (!value.trim()) throw new Error("Authorization identifiers cannot be empty");
  return keccak256(stringToHex(value));
}
