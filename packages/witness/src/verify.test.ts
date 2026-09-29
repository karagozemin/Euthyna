import { describe, expect, it } from "vitest";
import { knownFrom, makeValidInput } from "./fixtures.js";
import { verifyObligation } from "./verify.js";

function resultFor(mutator: (input: ReturnType<typeof makeValidInput>) => void) {
  const input = makeValidInput();
  mutator(input);
  return verifyObligation(input);
}

describe("Evidence Witness W01-W10", () => {
  it("VERIFIED: accepts a complete legitimate obligation", () => {
    const result = verifyObligation(makeValidInput());
    expect(result.verdict).toBe("VERIFIED");
    expect(result.checks).toHaveLength(10);
    expect(result.checks.every((check) => check.status === "PASS")).toBe(true);
    expect(result.evidenceRoot).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("W01 HOLD: missing required evidence", () => {
    const result = resultFor((input) => {
      input.artifacts = input.artifacts.filter((artifact) => artifact.type !== "DELIVERY");
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reasonCode).toBe("MISSING_EVIDENCE");
  });

  it("W02 REJECT: explicit vendor mismatch", () => {
    const result = resultFor((input) => {
      input.artifacts[0]!.fields.vendorId = "vendor_attacker";
    });
    expect(result.verdict).toBe("REJECT");
    expect(result.reasonCode).toBe("VENDOR_MISMATCH");
  });

  it("W03 HOLD: amount mismatch uses bigint tolerance", () => {
    const result = resultFor((input) => {
      input.artifacts[0]!.fields.amountMinor = "125000002";
      input.policy.amountToleranceMinor = "1";
    });
    expect(result.reasonCode).toBe("AMOUNT_MISMATCH");
  });

  it("W04 HOLD: cancelled agreement", () => {
    const result = resultFor((input) => {
      input.artifacts[1]!.fields.agreementStatus = "CANCELLED";
    });
    expect(result.reasonCode).toBe("AGREEMENT_INVALID");
  });

  it("W05 HOLD: delivery not accepted", () => {
    const result = resultFor((input) => {
      input.artifacts[2]!.fields.deliveryAccepted = false;
    });
    expect(result.reasonCode).toBe("DELIVERY_UNVERIFIED");
  });

  it("W06 REJECT: same semantic obligation with different technical upload", () => {
    const result = resultFor((input) => {
      const known = knownFrom(input.obligation, input.artifacts, { artifactHashes: [] });
      input.knownObligations.push(known);
      input.artifacts[0]!.contentHash = `sha256:${"d".repeat(64)}`;
    });
    expect(result.verdict).toBe("REJECT");
    expect(result.reasonCode).toBe("DUPLICATE_OBLIGATION");
  });

  it("W06 REJECT: formatting changes do not change invoice identity", () => {
    const result = resultFor((input) => {
      input.knownObligations.push(knownFrom({ ...input.obligation, invoiceNumber: "inv 1042" }, [], { artifactHashes: [] }));
    });
    expect(result.verdict).toBe("REJECT");
    expect(result.reasonCode).toBe("DUPLICATE_OBLIGATION");
  });

  it("W06 HOLD: same vendor, invoice number, and amount with a changed invoice date", () => {
    const result = resultFor((input) => {
      input.knownObligations.push(knownFrom({ ...input.obligation, invoiceDate: "2026-09-24" }, [], { artifactHashes: [] }));
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.checks.find((check) => check.id === "W06")?.observed).toMatchObject({
      match: "VENDOR_INVOICE_NUMBER_AMOUNT",
    });
  });

  it("allows a legitimate recurring invoice with a different invoice number and period", () => {
    const result = resultFor((input) => {
      input.obligation.invoiceNumber = "INV-1043";
      input.obligation.invoiceDate = "2026-10-25";
      input.obligation.dueDate = "2026-10-30";
      input.obligation.lineItems = [];
      input.artifacts.forEach((artifact) => { artifact.fields.lineItems = []; });
      input.knownObligations.push(knownFrom({ ...input.obligation, invoiceNumber: "INV-1042", invoiceDate: "2026-09-25", dueDate: "2026-09-30" }, [], { artifactHashes: [], lineItemCount: 0 }));
    });
    expect(result.checks.find((check) => check.id === "W06")?.status).toBe("PASS");
  });

  it("allows an explicit corrected invoice linked to a rejected original", () => {
    const result = resultFor((input) => {
      input.obligation.invoiceDate = "2026-09-26";
      input.obligation.revisionOfObligationId = "obl_existing";
      input.knownObligations.push(knownFrom({ ...input.obligation, revisionOfObligationId: null, invoiceDate: "2026-09-25" }, [], { status: "REJECTED", artifactHashes: [] }));
    });
    expect(result.checks.find((check) => check.id === "W06")?.status).toBe("PASS");
  });

  it("W06 HOLD: near duplicate with changed invoice number", () => {
    const result = resultFor((input) => {
      const known = knownFrom(
        { ...input.obligation, invoiceNumber: "OTHER-REF" },
        [],
        { artifactHashes: [] },
      );
      input.knownObligations.push(known);
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reasonCode).toBe("DUPLICATE_OBLIGATION");
  });

  it("W07 HOLD: invoice proposes a changed payout destination", () => {
    const result = resultFor((input) => {
      input.artifacts[0]!.fields.payoutDestination =
        "0x2222222222222222222222222222222222222222";
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reasonCode).toBe("DESTINATION_CHANGED");
    expect(result.requiredAction).toBe("OWNER_REVERIFY_VENDOR_DESTINATION");
  });

  it("W07 HOLD: distinguishes initial onboarding from an unauthorized change", () => {
    const result = resultFor((input) => {
      input.vendor.status = "PENDING_ONBOARDING";
      input.vendor.currentVersion = 0;
      input.vendorDestination = null;
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reasonCode).toBe("DESTINATION_UNVERIFIED");
    expect(result.requiredAction).toBe("OWNER_VERIFY_INITIAL_VENDOR_DESTINATION");
  });

  it("W08 REJECT: obligation already settled on-chain", () => {
    const result = resultFor((input) => {
      input.knownObligations.push(
        knownFrom(input.obligation, input.artifacts, {
          status: "SETTLED",
          settledTxHash: `0x${"e".repeat(64)}`,
        }),
      );
    });
    expect(result.verdict).toBe("REJECT");
    expect(result.checks.find((check) => check.id === "W08")?.reasonCode).toBe(
      "ALREADY_SETTLED",
    );
  });

  it("W09 HOLD: expired evidence", () => {
    const result = resultFor((input) => {
      input.artifacts[0]!.validUntil = "2026-09-28T23:59:59.000Z";
    });
    expect(result.reasonCode).toBe("STALE_EVIDENCE");
  });

  it("W10 HOLD: ambiguous required field", () => {
    const result = resultFor((input) => {
      input.artifacts[0]!.fields.ambiguousFields = ["amountMinor"];
    });
    expect(result.reasonCode).toBe("AMBIGUOUS_FIELD");
  });

  it("W10 HOLD: present evidence class with unresolved normalized payment field", () => {
    const result = resultFor((input) => {
      input.artifacts[0]!.fields.payoutDestination = null;
    });
    expect(result.reasonCode).toBe("AMBIGUOUS_FIELD");
    expect(result.checks.find((check) => check.id === "W10")?.observed).toMatchObject({
      unresolved: ["art_invoice.payoutDestination"],
    });
  });

  it("does not call empty line-item sets materially similar", () => {
    const result = resultFor((input) => {
      input.obligation.invoiceNumber = "INV-NEW";
      input.obligation.lineItems = [];
      input.artifacts.forEach((artifact) => {
        artifact.fields.lineItems = [];
      });
      const candidate = knownFrom(
        { ...input.obligation, invoiceNumber: "INV-OLD", lineItems: [] },
        [],
        { artifactHashes: [], lineItemCount: 0 },
      );
      input.knownObligations.push(candidate);
    });
    expect(result.checks.find((check) => check.id === "W06")?.status).toBe("PASS");
  });

  it("evaluates all checks but deterministically prioritizes REJECT over HOLD", () => {
    const result = resultFor((input) => {
      input.artifacts = input.artifacts.filter((artifact) => artifact.type !== "DELIVERY");
      input.artifacts[0]!.fields.vendorId = "vendor_attacker";
    });
    expect(result.verdict).toBe("REJECT");
    expect(result.reasonCode).toBe("VENDOR_MISMATCH");
    expect(result.checks.find((check) => check.id === "W01")?.status).toBe("FAIL");
    expect(result.checks.find((check) => check.id === "W02")?.status).toBe("FAIL");
  });
});
