import type { BusinessState, PlanningObligation } from "@euthyna/domain";
import { describe, expect, it } from "vitest";
import { BoundedDecisionAgent } from "./agent.js";
import { validatePaymentPlan } from "./validator.js";

const state: BusinessState = {
  businessId: "biz_demo",
  asOf: "2026-09-29T12:00:00.000Z",
  availableBalanceMinor: "1000000000",
  minimumReserveMinor: "300000000",
  approvalThresholdMinor: "650000000",
  currency: "USDC",
  tokenDecimals: 6,
  expectedInflows: [
    { id: "inflow_oct_2", expectedOn: "2026-10-02", amountMinor: "400000000", confidenceBps: 8500 },
  ],
};

function obligation(overrides: Partial<PlanningObligation>): PlanningObligation {
  return {
    obligationId: "obl_base",
    vendorId: "vendor_base",
    witnessVerdict: "VERIFIED",
    evidenceRoot: `0x${"a".repeat(64)}`,
    vendorVersion: 1,
    amountMinor: "100000000",
    currency: "USDC",
    tokenDecimals: 6,
    payee: "0x1111111111111111111111111111111111111111",
    dueDate: "2026-10-15",
    vendorCriticality: 2,
    lateFeeBps: 0,
    earlyPayDiscountBps: 0,
    earlyPayDeadline: null,
    partialPaymentAllowed: false,
    ...overrides,
  };
}

const competing: PlanningObligation[] = [
  obligation({
    obligationId: "obl_critical",
    vendorId: "vendor_infra",
    amountMinor: "500000000",
    dueDate: "2026-09-29",
    vendorCriticality: 5,
  }),
  obligation({
    obligationId: "obl_discount",
    vendorId: "vendor_discount",
    amountMinor: "200000000",
    dueDate: "2026-10-10",
    earlyPayDiscountBps: 500,
    earlyPayDeadline: "2026-09-30",
  }),
  obligation({
    obligationId: "obl_low",
    vendorId: "vendor_low",
    amountMinor: "300000000",
    dueDate: "2026-10-20",
    vendorCriticality: 1,
  }),
];

describe("Decision Agent and deterministic plan validator", () => {
  it("prioritizes competing legitimate obligations while preserving reserve", async () => {
    const plan = await new BoundedDecisionAgent().createPlan({ state, obligations: competing });
    expect(plan.decisions.map((decision) => [decision.obligationId, decision.action])).toEqual([
      ["obl_critical", "PAY_NOW"],
      ["obl_discount", "PAY_NOW"],
      ["obl_low", "SCHEDULE"],
    ]);
    const validation = validatePaymentPlan(plan, { state, obligations: competing });
    expect(validation).toMatchObject({ valid: true, projectedImmediateBalanceMinor: "300000000" });
  });

  it("never includes HOLD obligations in agent output", async () => {
    const held = obligation({ obligationId: "obl_held", witnessVerdict: "HOLD" });
    const plan = await new BoundedDecisionAgent().createPlan({ state, obligations: [...competing, held] });
    expect(plan.decisions.some((decision) => decision.obligationId === held.obligationId)).toBe(false);
  });

  it("rejects model attempts to change amount, payee, or cross the reserve", async () => {
    const plan = await new BoundedDecisionAgent().createPlan({ state, obligations: competing });
    plan.decisions[0]!.amountMinor = "700000000";
    plan.decisions[0]!.payee = "0x2222222222222222222222222222222222222222";
    const validation = validatePaymentPlan(plan, { state, obligations: competing });
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["AMOUNT_CHANGED", "PAYEE_CHANGED", "APPROVAL_REQUIRED", "RESERVE_VIOLATION"]),
    );
  });

  it("rejects an executable decision for a non-verified obligation", async () => {
    const plan = await new BoundedDecisionAgent().createPlan({ state, obligations: competing });
    const source = competing.map((item) => ({ ...item }));
    source[0]!.witnessVerdict = "HOLD";
    const validation = validatePaymentPlan(plan, { state, obligations: source });
    expect(validation.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "OBLIGATION_NOT_VERIFIED" })]),
    );
  });
});

