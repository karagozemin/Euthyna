import { describe, expect, it } from "vitest";
import { ARC_PROOF } from "./data";
import { validateArcSnapshot } from "./arc-live";

const validInput = {
  chainIdHex: `0x${ARC_PROOF.chainId.toString(16)}`,
  latestBlockHex: "0x3df5d79",
  receipt: {
    blockNumber: `0x${Number(ARC_PROOF.settlementBlock).toString(16)}`,
    status: "0x1",
    transactionHash: ARC_PROOF.transaction,
  },
  vaultCode: "0x60006000",
  latencyMs: 83.7,
  verifiedAt: "2026-10-01T15:50:00.000Z",
};

describe("validateArcSnapshot", () => {
  it("accepts the committed Arc settlement receipt", () => {
    expect(validateArcSnapshot(validInput)).toMatchObject({
      chainId: ARC_PROOF.chainId,
      settlementBlock: Number(ARC_PROOF.settlementBlock),
      receiptStatus: "SUCCESS",
      vaultDeployed: true,
      latencyMs: 84,
    });
  });

  it("rejects a reverted transaction", () => {
    expect(() => validateArcSnapshot({ ...validInput, receipt: { ...validInput.receipt, status: "0x0" } }))
      .toThrow("reverted");
  });

  it("rejects an address without contract bytecode", () => {
    expect(() => validateArcSnapshot({ ...validInput, vaultCode: "0x" })).toThrow("No vault contract bytecode");
  });

  it("rejects the wrong network", () => {
    expect(() => validateArcSnapshot({ ...validInput, chainIdHex: "0x1" })).toThrow("Wrong network");
  });
});
