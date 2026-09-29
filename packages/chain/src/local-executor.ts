import { SettlementSchema, type Settlement, type WitnessAttestation } from "@euthyna/domain";
import { canonicalJson, sha256Hex } from "@euthyna/evidence";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  WITNESS_TYPES,
  hashWitnessAttestation,
  toContractAttestation,
} from "./attestation.js";

export interface LocalAuthorization {
  attestation: WitnessAttestation;
  signature: Hex;
}

/** Deterministic CI adapter; never selected by production configuration. */
export class LocalDeterministicExecutor {
  private readonly byObligation = new Map<string, Settlement>();
  private readonly operationIds = new Set<string>();

  constructor(
    private readonly expectedSigner: Address,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Local deterministic executor is forbidden in production");
    }
  }

  async submit(input: LocalAuthorization): Promise<Settlement> {
    const existing = this.byObligation.get(input.attestation.obligationId);
    if (existing) return structuredClone(existing);
    const attestation = input.attestation;
    if (this.operationIds.has(attestation.operationId)) throw new Error("Local operation replay");
    if (BigInt(attestation.validUntilUnix) < BigInt(Math.floor(this.now().getTime() / 1_000))) {
      throw new Error("Local authorization expired");
    }
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "Euthyna ObligationVault",
        version: "1",
        chainId: Number(attestation.chainId),
        verifyingContract: attestation.verifyingContract as Address,
      },
      types: WITNESS_TYPES,
      primaryType: "WitnessAttestation",
      message: toContractAttestation(attestation),
      signature: input.signature,
    });
    if (recovered.toLowerCase() !== this.expectedSigner.toLowerCase()) {
      throw new Error("Local witness signature mismatch");
    }
    const txHash = sha256Hex(canonicalJson({ attestation, signature: input.signature }));
    const settlement = SettlementSchema.parse({
      chainId: Number(attestation.chainId),
      network: "LOCAL_DETERMINISTIC",
      txHash,
      blockNumber: String(this.byObligation.size + 1),
      status: "FINAL",
      explorerUrl: `https://local.invalid/tx/${txHash}`,
      finalizedAt: this.now().toISOString(),
      operationId: attestation.operationId,
      vendorIdHash: attestation.vendorIdHash,
      payee: attestation.payee,
      amountMinor: attestation.amountMinor,
      evidenceRoot: attestation.evidenceRoot,
      decisionCommitmentHash: attestation.decisionCommitmentHash,
      attestationHash: hashWitnessAttestation(
        Number(attestation.chainId),
        attestation.verifyingContract as Address,
        attestation,
      ),
    });
    this.operationIds.add(attestation.operationId);
    this.byObligation.set(attestation.obligationId, settlement);
    return structuredClone(settlement);
  }

  reconcile(obligationId: Hex): Settlement | null {
    return structuredClone(this.byObligation.get(obligationId) ?? null);
  }
}
