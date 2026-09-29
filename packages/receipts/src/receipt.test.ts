import type { DecisionCommitmentBody, DecisionReceiptBody, WitnessCheck } from "@euthyna/domain";
import { describe, expect, it } from "vitest";
import {
  createDecisionCommitment,
  createDecisionReceipt,
  verifyDecisionCommitment,
  verifyDecisionReceipt,
} from "./receipt.js";

const checks = Array.from({ length: 10 }, (_, index): WitnessCheck => ({
  id: `W${String(index + 1).padStart(2, "0")}` as WitnessCheck["id"],
  name: `Check ${index + 1}`,
  status: "PASS",
  disposition: "NONE",
  reasonCode: null,
  expected: null,
  observed: null,
  relatedArtifactIds: [],
}));

function body(): DecisionReceiptBody {
  return {
    receiptId: "rcpt_demo",
    businessId: "biz_demo",
    vendorId: "vendor_acme",
    obligationId: "obl_1042",
    classification: "TEST",
    agent: {
      planId: "plan_demo",
      action: "PAY_NOW",
      reasonCodes: ["DUE_OR_OVERDUE", "CRITICAL_VENDOR"],
      rationale: "Pay the critical verified obligation while preserving reserve.",
      businessStateHash: `0x${"1".repeat(64)}`,
      provider: "euthyna",
      model: "bounded-priority",
      version: "1.0.0",
    },
    witness: {
      verdict: "VERIFIED",
      reasonCode: null,
      evidenceRoot: `0x${"2".repeat(64)}`,
      checks,
      vendorVersion: 3,
    },
    decisionCommitmentHash: `0x${"4".repeat(64)}`,
    authorization: {
      policyVersion: 5,
      attestationHash: `0x${"3".repeat(64)}`,
      validUntil: "2026-09-29T12:10:00.000Z",
      signerVersion: "witness-key-1",
    },
    settlement: null,
    humanAction: null,
    createdAt: "2026-09-29T12:00:00.000Z",
  };
}

describe("DecisionReceipt canonical commitment", () => {
  it("creates a non-circular decision/evidence/payment commitment", () => {
    const commitmentBody: DecisionCommitmentBody = {
      commitmentVersion: "1",
      receiptId: "rcpt_demo",
      businessId: "biz_demo",
      vendorId: "vendor_acme",
      obligationId: "obl_1042",
      classification: "TEST",
      agent: body().agent,
      witness: body().witness,
      payment: {
        operationId: "op_release_1",
        payee: "0x2222222222222222222222222222222222222222",
        token: "0x3600000000000000000000000000000000000000",
        amountMinor: "125000000",
      },
      authorizationContext: {
        policyVersion: 5,
        witnessVersion: 1,
        rulesVersion: 1,
        validUntilUnix: "1800000600",
        chainId: 5_042_002,
        verifyingContract: "0x1111111111111111111111111111111111111111",
      },
      createdAt: "2026-09-29T12:00:00.000Z",
    };
    const commitment = createDecisionCommitment(commitmentBody);
    expect(verifyDecisionCommitment(commitment)).toBe(true);
    expect(commitment).not.toHaveProperty("attestationHash");
    expect(commitment).not.toHaveProperty("settlement");
    expect(commitment).not.toHaveProperty("finalReceiptHash");
  });

  it("is deterministic and self-verifiable", () => {
    const first = createDecisionReceipt(body());
    const second = createDecisionReceipt(structuredClone(body()));
    expect(first.finalReceiptHash).toBe(second.finalReceiptHash);
    expect(verifyDecisionReceipt(first)).toBe(true);
  });

  it("detects a changed rationale", () => {
    const receipt = createDecisionReceipt(body());
    receipt.agent.rationale = "Altered after settlement";
    expect(verifyDecisionReceipt(receipt)).toBe(false);
  });
});
