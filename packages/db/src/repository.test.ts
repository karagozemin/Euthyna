import { describe, expect, it } from "vitest";
import { InMemoryEuthynaRepository } from "./repository.js";

const at = "2026-09-30T00:00:00.000Z";
const vendor = {
  id: "vendor_1", businessId: "biz_1", legalName: "Vendor One", normalizedName: "VENDOR ONE",
  status: "PENDING_ONBOARDING" as const, currentVersion: 0,
};

describe("transactional repository and vendor continuity", () => {
  it("distinguishes initial onboarding from a later destination change and preserves history", async () => {
    const repository = new InMemoryEuthynaRepository();
    await repository.transaction((tx) => {
      tx.createVendor(vendor, "owner", at);
      const initial = tx.proposeDestination(vendor.id, "0x1111111111111111111111111111111111111111", "ARC_TESTNET", "owner", at);
      expect(initial.changeKind).toBe("INITIAL_ONBOARDING");
      tx.verifyDestination(vendor.id, initial.version, "OUT_OF_BAND", "owner", at);
      const changed = tx.proposeDestination(vendor.id, "0x2222222222222222222222222222222222222222", "ARC_TESTNET", "invoice", at);
      expect(changed.changeKind).toBe("DESTINATION_CHANGE");
      expect(tx.getVendor(vendor.id).status).toBe("PENDING_CHANGE");
      expect(tx.currentDestination(vendor.id)?.address).toBe("0x1111111111111111111111111111111111111111");
      expect(tx.destinationHistory(vendor.id)).toHaveLength(2);
    });
  });

  it("rolls back every write when a transaction fails", async () => {
    const repository = new InMemoryEuthynaRepository();
    await expect(repository.transaction((tx) => {
      tx.createVendor(vendor, "owner", at);
      throw new Error("simulated database failure");
    })).rejects.toThrow(/simulated database failure/);
    expect(repository.snapshot().vendors.size).toBe(0);
    expect(repository.snapshot().auditEvents).toHaveLength(0);
  });

  it("records SUBMITTED -> HOLD when execution fails and stores no settlement", async () => {
    const repository = new InMemoryEuthynaRepository();
    const obligation = {
      id: "obl_1", businessId: "biz_1", vendorId: "vendor_1", invoiceNumber: "INV-1",
      invoiceDate: "2026-09-30", agreementReference: "PO-1", amountMinor: "1000000", currency: "USDC",
      tokenDecimals: 6, dueDate: "2026-10-01", requestedPayoutDestination: "0x1111111111111111111111111111111111111111",
      partialPaymentAllowed: false, revisionOfObligationId: null, status: "AUTHORIZED" as const, lineItems: [], settledTxHash: null,
    };
    await repository.transaction((tx) => {
      tx.createObligation(obligation, [], "api", at);
      tx.markSubmitted(obligation.id, "executor", at);
      tx.markExecutionFailed(obligation.id, "executor", "TRANSACTION_REVERTED", at);
    });
    expect(repository.snapshot().obligations.get(obligation.id)?.obligation.status).toBe("HOLD");
    expect(repository.snapshot().settlements.size).toBe(0);
  });
});
