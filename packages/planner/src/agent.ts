import {
  BusinessStateSchema,
  PaymentPlanSchema,
  PlanningObligationSchema,
  type BusinessState,
  type PaymentDecision,
  type PaymentPlan,
  type PlannerReasonCode,
  type PlanningObligation,
} from "@euthyna/domain";
import { canonicalJson, sha256Hex } from "@euthyna/evidence";

export interface PlanningContext {
  state: BusinessState;
  obligations: PlanningObligation[];
}

export interface DecisionAgent {
  createPlan(context: PlanningContext): Promise<PaymentPlan>;
}

interface RankedObligation {
  obligation: PlanningObligation;
  score: number;
  reasonCodes: PlannerReasonCode[];
}

function dayDistance(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function rank(obligation: PlanningObligation, today: string): RankedObligation {
  const daysUntilDue = dayDistance(today, obligation.dueDate);
  const reasons: PlannerReasonCode[] = [];
  let score = obligation.vendorCriticality * 1_000 + obligation.lateFeeBps;
  if (daysUntilDue <= 0) {
    score += 100_000;
    reasons.push("DUE_OR_OVERDUE");
  } else if (daysUntilDue <= 3) {
    score += 50_000 - daysUntilDue * 1_000;
    reasons.push("DUE_SOON");
  }
  if (obligation.vendorCriticality >= 4) reasons.push("CRITICAL_VENDOR");
  if (
    obligation.earlyPayDiscountBps > 0 &&
    obligation.earlyPayDeadline !== null &&
    obligation.earlyPayDeadline >= today
  ) {
    score += obligation.earlyPayDiscountBps * 5;
    reasons.push("EARLY_PAY_DISCOUNT");
  }
  if (reasons.length === 0) reasons.push("LOWER_PRIORITY");
  return { obligation, score, reasonCodes: reasons };
}

function deterministicPlanId(stateHash: string, createdAt: string): string {
  return `plan_${sha256Hex(`${stateHash}:${createdAt}`).slice(2, 18)}`;
}

/**
 * Reviewable fallback agent for demos and tests. It performs bounded economic
 * prioritization; it does not verify evidence, sign attestations, or move funds.
 * A model-backed implementation must emit the same schema and pass the same validator.
 */
export class BoundedDecisionAgent implements DecisionAgent {
  async createPlan(rawContext: PlanningContext): Promise<PaymentPlan> {
    const state = BusinessStateSchema.parse(rawContext.state);
    const obligations = rawContext.obligations.map((item) => PlanningObligationSchema.parse(item));
    const eligible = obligations.filter((item) => item.witnessVerdict === "VERIFIED");
    const today = state.asOf.slice(0, 10);
    const stateHash = sha256Hex(canonicalJson(state));
    let spendable = BigInt(state.availableBalanceMinor) - BigInt(state.minimumReserveMinor);
    if (spendable < 0n) spendable = 0n;

    const ranked = eligible
      .map((obligation) => rank(obligation, today))
      .sort((left, right) => right.score - left.score || left.obligation.dueDate.localeCompare(right.obligation.dueDate));

    const decisions: PaymentDecision[] = ranked.map(({ obligation, reasonCodes }) => {
      const amount = BigInt(obligation.amountMinor);
      const aboveApproval = amount > BigInt(state.approvalThresholdMinor);
      if (aboveApproval) {
        return {
          obligationId: obligation.obligationId,
          action: "ESCALATE",
          amountMinor: obligation.amountMinor,
          currency: obligation.currency,
          payee: obligation.payee,
          scheduledFor: null,
          reasonCodes: [...reasonCodes, "APPROVAL_REQUIRED"],
          rationale: "The obligation is legitimate but exceeds the autonomous approval threshold.",
          confidenceBps: 10_000,
        };
      }
      if (amount <= spendable) {
        spendable -= amount;
        return {
          obligationId: obligation.obligationId,
          action: "PAY_NOW",
          amountMinor: obligation.amountMinor,
          currency: obligation.currency,
          payee: obligation.payee,
          scheduledFor: null,
          reasonCodes,
          rationale: `Pay this verified obligation now; its economic priority is higher and the ${state.currency} reserve remains intact.`,
          confidenceBps: 9_000,
        };
      }

      const inflow = [...state.expectedInflows]
        .filter((item) => item.confidenceBps >= 7_500 && BigInt(item.amountMinor) >= amount)
        .sort((left, right) => left.expectedOn.localeCompare(right.expectedOn))[0];
      if (inflow) {
        return {
          obligationId: obligation.obligationId,
          action: "SCHEDULE",
          amountMinor: obligation.amountMinor,
          currency: obligation.currency,
          payee: obligation.payee,
          scheduledFor: inflow.expectedOn,
          reasonCodes: [...reasonCodes, "PRESERVE_RESERVE", "EXPECTED_INFLOW"],
          rationale: `Schedule after expected inflow ${inflow.id}; paying now would breach the reserve floor.`,
          confidenceBps: inflow.confidenceBps,
        };
      }
      return {
        obligationId: obligation.obligationId,
        action: "ESCALATE",
        amountMinor: obligation.amountMinor,
        currency: obligation.currency,
        payee: obligation.payee,
        scheduledFor: null,
        reasonCodes: [...reasonCodes, "PRESERVE_RESERVE", "INSUFFICIENT_LIQUIDITY"],
        rationale: "No sufficiently reliable inflow can fund this obligation without breaching the reserve floor.",
        confidenceBps: 10_000,
      };
    });

    const createdAt = state.asOf;
    return PaymentPlanSchema.parse({
      planId: deterministicPlanId(stateHash, createdAt),
      businessId: state.businessId,
      businessStateHash: stateHash,
      agent: { provider: "euthyna", model: "bounded-priority", version: "1.0.0" },
      decisions,
      assumptions: state.expectedInflows.map((item) => item.id),
      createdAt,
    });
  }
}

