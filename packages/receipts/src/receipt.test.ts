import type { DecisionReceiptBody, WitnessCheck } from "@euthyna/domain";
import { describe, expect, it } from "vitest";
import { createDecisionReceipt, verifyDecisionReceipt } from "./receipt.js";

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
  it("is deterministic and self-verifiable", () => {
    const first = createDecisionReceipt(body());
    const second = createDecisionReceipt(structuredClone(body()));
    expect(first.receiptHash).toBe(second.receiptHash);
    expect(verifyDecisionReceipt(first)).toBe(true);
  });

  it("detects a changed rationale", () => {
    const receipt = createDecisionReceipt(body());
    receipt.agent.rationale = "Altered after settlement";
    expect(verifyDecisionReceipt(receipt)).toBe(false);
  });
});

