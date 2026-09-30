import { describe, expect, it } from "vitest";
import publicArtifact from "../../../artifacts/first-arc-settlement.json";
import { ARC_PROOF, DEMO_METRICS, OBLIGATIONS, REAL_METRICS, SCENARIOS } from "./data";

describe("reviewer demo data", () => {
  it("pins the live proof to the committed Arc settlement artifact", () => {
    expect(ARC_PROOF.transaction).toBe(publicArtifact.settlement.txHash);
    expect(ARC_PROOF.settlementBlock).toBe(publicArtifact.settlement.blockNumber);
    expect(ARC_PROOF.evidenceRoot).toBe(publicArtifact.settlement.evidenceRoot);
    expect(ARC_PROOF.decisionCommitment).toBe(publicArtifact.settlement.decisionCommitmentHash);
    expect(ARC_PROOF.attestationHash).toBe(publicArtifact.settlement.attestationHash);
    expect(ARC_PROOF.finalReceiptHash).toBe(publicArtifact.finalReceipt.finalReceiptHash);
    expect(publicArtifact.classification).toBe("TEST");
    expect(publicArtifact.settlement.status).toBe("RECONCILED");
  });

  it("keeps all four deterministic reviewer scenarios explicit", () => {
    expect(SCENARIOS.map((scenario) => scenario.slug)).toEqual([
      "valid",
      "prioritization",
      "duplicate",
      "destination-change",
    ]);
    expect(SCENARIOS.every((scenario) => scenario.checks.length === 10)).toBe(true);
  });

  it("stops duplicate and destination-change scenarios before payment", () => {
    const duplicate = SCENARIOS.find((scenario) => scenario.slug === "duplicate")!;
    const destination = SCENARIOS.find((scenario) => scenario.slug === "destination-change")!;

    expect(duplicate.obligations[0]).toMatchObject({ witnessVerdict: "REJECTED", settlementStatus: "NOT_SUBMITTED" });
    expect(duplicate.checks.find((check) => check.id === "W06")).toMatchObject({ status: "REJECT" });
    expect(destination.obligations[0]).toMatchObject({ witnessVerdict: "HOLD", settlementStatus: "NOT_SUBMITTED" });
    expect(destination.checks.find((check) => check.id === "W07")).toMatchObject({ status: "HOLD" });
  });

  it("separates demo metrics from real pilot traction", () => {
    expect(OBLIGATIONS.every((obligation) => obligation.classification === "TEST")).toBe(true);
    expect(DEMO_METRICS.obligationsProcessed).toBe(6);
    expect(REAL_METRICS.obligationsProcessed).toBe(0);
    expect(REAL_METRICS.totalPaymentVolume).toBe("0 USDC");
  });
});
