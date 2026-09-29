import { describe, expect, it } from "vitest";
import { canonicalJson, lineItemFingerprint, obligationFingerprint } from "./canonical.js";

describe("canonical evidence primitives", () => {
  it("canonicalizes object key order", () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe(
      canonicalJson({ a: { b: 1, d: 2 }, z: 1 }),
    );
  });

  it("uses business-semantic invoice identity instead of file identity", () => {
    const base = {
      businessId: "biz_1",
      vendorId: "vendor_1",
      invoiceDate: "2026-09-29",
      amountMinor: "125000000",
      currency: "USDC",
    } as const;
    expect(obligationFingerprint({ ...base, invoiceNumber: "INV-1042" })).toBe(
      obligationFingerprint({ ...base, invoiceNumber: " inv 1042 " }),
    );
  });

  it("makes line item ordering irrelevant without floating point", () => {
    const first = { description: "Hosting", amountMinor: "5000000", quantityMinor: "1" };
    const second = { description: "Support", amountMinor: "2500000", quantityMinor: "1" };
    expect(lineItemFingerprint([first, second])).toBe(lineItemFingerprint([second, first]));
  });
});

