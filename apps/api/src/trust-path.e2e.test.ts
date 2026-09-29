import { InMemoryEuthynaRepository } from "@euthyna/db";
import type { BusinessState, PlanningObligation } from "@euthyna/domain";
import { LocalDeterministicExecutor } from "@euthyna/chain";
import { BoundedDecisionAgent, validatePaymentPlan } from "@euthyna/planner";
import { createDecisionReceipt } from "@euthyna/receipts";
import {
  LocalPrivateKeyWitnessSigner,
  WitnessAuthorizationService,
  makeValidInput,
  verifyObligation,
} from "@euthyna/witness";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

const privateKey = `0x${"11".repeat(32)}` as Hex;
const vault = "0x1111111111111111111111111111111111111111" as Address;
const token = "0x3600000000000000000000000000000000000000" as Address;
const chainId = 5_042_002;
const now = new Date("2026-09-30T00:00:00.000Z");

describe("local end-to-end proof-of-obligation trust path", () => {
  it("reconciles the original settlement after a DB crash without a second execution", async () => {
    const repository = new InMemoryEuthynaRepository();
    const input = makeValidInput();
    const pendingVendor = { ...input.vendor, status: "PENDING_ONBOARDING" as const, currentVersion: 0 };

    await repository.transaction((tx) => {
      tx.createVendor(pendingVendor, "owner", now.toISOString());
      const proposed = tx.proposeDestination(pendingVendor.id, input.vendorDestination!.address, "ARC_TESTNET", "owner", now.toISOString());
      tx.verifyDestination(pendingVendor.id, proposed.version, "OUT_OF_BAND", "owner", now.toISOString());
      for (const artifact of input.artifacts) tx.putArtifact(artifact, "ingestion-worker");
      tx.createObligation(input.obligation, input.artifacts.map((artifact) => artifact.id), "api", now.toISOString());
    });

    const witness = await repository.transaction((tx) => {
      const stored = tx.getObligation(input.obligation.id);
      const result = verifyObligation({
        ...input,
        obligation: stored.obligation,
        vendor: tx.getVendor(stored.obligation.vendorId),
        vendorDestination: tx.currentDestination(stored.obligation.vendorId),
        artifacts: tx.getArtifacts(stored.evidenceIds),
        evaluatedAt: now.toISOString(),
      });
      tx.saveWitnessResult(result, "witness:rules-v1");
      return result;
    });
    expect(witness.verdict).toBe("VERIFIED");

    const state: BusinessState = {
      businessId: input.obligation.businessId,
      asOf: now.toISOString(),
      availableBalanceMinor: "500000000",
      minimumReserveMinor: "100000000",
      approvalThresholdMinor: "200000000",
      currency: "USDC",
      tokenDecimals: 6,
      expectedInflows: [],
    };
    const planningObligation: PlanningObligation = {
      obligationId: input.obligation.id,
      vendorId: input.obligation.vendorId,
      witnessVerdict: witness.verdict,
      evidenceRoot: witness.evidenceRoot,
      vendorVersion: witness.vendorVersion,
      amountMinor: input.obligation.amountMinor,
      currency: input.obligation.currency,
      tokenDecimals: input.obligation.tokenDecimals,
      payee: input.obligation.requestedPayoutDestination,
      dueDate: input.obligation.dueDate,
      vendorCriticality: 5,
      lateFeeBps: 0,
      earlyPayDiscountBps: 0,
      earlyPayDeadline: null,
      partialPaymentAllowed: false,
    };
    const plan = await new BoundedDecisionAgent().createPlan({ state, obligations: [planningObligation] });
    const validation = validatePaymentPlan(plan, { state, obligations: [planningObligation] });
    expect(validation.valid).toBe(true);
    await repository.transaction((tx) => {
      tx.savePlan(plan);
      tx.transitionObligation(input.obligation.id, "PLANNED", "decision-agent", null, now.toISOString());
    });

    const preReceipt = createDecisionReceipt({
      receiptId: "rcpt_obl_valid",
      businessId: input.obligation.businessId,
      vendorId: input.obligation.vendorId,
      obligationId: input.obligation.id,
      classification: "TEST",
      agent: {
        planId: plan.planId,
        action: plan.decisions[0]!.action,
        reasonCodes: plan.decisions[0]!.reasonCodes,
        rationale: plan.decisions[0]!.rationale,
        businessStateHash: plan.businessStateHash,
        ...plan.agent,
      },
      witness: { verdict: witness.verdict, reasonCode: witness.reasonCode, evidenceRoot: witness.evidenceRoot, checks: witness.checks, vendorVersion: witness.vendorVersion },
      authorization: { policyVersion: witness.policyVersion, attestationHash: null, validUntil: null, signerVersion: null },
      settlement: null,
      humanAction: null,
      createdAt: now.toISOString(),
    });
    const signer = new LocalPrivateKeyWitnessSigner(privateKey, chainId, vault);
    const authorization = await new WitnessAuthorizationService(signer).issue(witness, validation, {
      operationId: "op_obl_valid_release_1", businessId: input.obligation.businessId, vendorId: input.obligation.vendorId,
      payee: input.obligation.requestedPayoutDestination as Address, token, amountMinor: input.obligation.amountMinor,
      receiptHash: preReceipt.receiptHash as Hex, validUntilUnix: "1790727000", chainId, verifyingContract: vault,
      witnessVersion: 1, rulesVersion: 1,
    });
    await repository.transaction((tx) => {
      tx.saveAuthorization({ id: "auth_1", operationId: "op_obl_valid_release_1", obligationId: input.obligation.id, attestationHash: authorization.attestationHash, payload: authorization, createdAt: now.toISOString() });
      tx.transitionObligation(input.obligation.id, "AUTHORIZED", "witness-signer:v1", null, now.toISOString());
    });

    const executor = new LocalDeterministicExecutor(signer.address, () => now);
    const onchainSettlement = await executor.submit({ attestation: authorization.attestation, signature: authorization.signature });
    await expect(repository.transaction((tx) => {
      tx.saveSettlement(input.obligation.id, onchainSettlement, "reconciler");
      throw new Error("database crashed after broadcast");
    })).rejects.toThrow(/crashed after broadcast/);
    expect(repository.snapshot().settlements.size).toBe(0);

    const retrySettlement = await executor.submit({ attestation: authorization.attestation, signature: authorization.signature });
    expect(retrySettlement.txHash).toBe(onchainSettlement.txHash);
    await repository.transaction((tx) => tx.saveSettlement(input.obligation.id, retrySettlement, "reconciler"));

    const finalReceipt = createDecisionReceipt({
      ...preReceipt,
      authorization: { policyVersion: witness.policyVersion, attestationHash: authorization.attestationHash, validUntil: "2026-09-30T00:10:00.000Z", signerVersion: "witness-v1" },
      settlement: retrySettlement,
    });
    await repository.transaction((tx) => tx.saveReceipt(finalReceipt));
    const snapshot = repository.snapshot();
    expect(snapshot.obligations.get(input.obligation.id)?.obligation.status).toBe("SETTLED");
    expect(snapshot.settlements.get(input.obligation.id)?.txHash).toBe(onchainSettlement.txHash);
    expect(snapshot.receipts.get(finalReceipt.receiptId)?.receiptHash).toBe(finalReceipt.receiptHash);
    expect(snapshot.auditEvents.length).toBeGreaterThan(8);
  });
});

