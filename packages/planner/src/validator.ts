import {
  BusinessStateSchema,
  PaymentPlanSchema,
  PlanValidationResultSchema,
  PlanningObligationSchema,
  type BusinessState,
  type PaymentPlan,
  type PlanValidationErrorCode,
  type PlanValidationResult,
  type PlanningObligation,
} from "@euthyna/domain";
import { normalizeAddress } from "@euthyna/evidence";

export interface PlanValidationContext {
  state: BusinessState;
  obligations: PlanningObligation[];
  humanApprovedObligationIds?: string[];
}

export function validatePaymentPlan(
  rawPlan: PaymentPlan,
  rawContext: PlanValidationContext,
): PlanValidationResult {
  const plan = PaymentPlanSchema.parse(rawPlan);
  const state = BusinessStateSchema.parse(rawContext.state);
  const obligations = rawContext.obligations.map((item) => PlanningObligationSchema.parse(item));
  const byId = new Map(obligations.map((item) => [item.obligationId, item]));
  const approvals = new Set(rawContext.humanApprovedObligationIds ?? []);
  const seen = new Set<string>();
  const errors: Array<{ obligationId: string | null; code: PlanValidationErrorCode; message: string }> = [];
  let immediateSpend = 0n;
  const today = state.asOf.slice(0, 10);

  for (const decision of plan.decisions) {
    const source = byId.get(decision.obligationId);
    const addError = (code: PlanValidationErrorCode, message: string) => {
      errors.push({ obligationId: decision.obligationId, code, message });
    };
    if (seen.has(decision.obligationId)) addError("DUPLICATE_DECISION", "An obligation appears more than once in the plan.");
    seen.add(decision.obligationId);
    if (!source) {
      addError("UNKNOWN_OBLIGATION", "The plan references an unknown obligation.");
      continue;
    }
    if (source.witnessVerdict !== "VERIFIED") {
      addError("OBLIGATION_NOT_VERIFIED", "Only VERIFIED obligations may enter an executable plan.");
    }
    const selectedAmount = BigInt(decision.amountMinor);
    const sourceAmount = BigInt(source.amountMinor);
    if (decision.action === "PARTIAL_PAY") {
      if (!source.partialPaymentAllowed) {
        addError("PARTIAL_PAYMENT_NOT_ALLOWED", "The obligation terms do not permit partial payment.");
      }
      if (selectedAmount <= 0n || selectedAmount >= sourceAmount) {
        addError("AMOUNT_CHANGED", "A partial payment must be positive and less than the obligation amount.");
      }
    } else if (selectedAmount !== sourceAmount) {
      addError("AMOUNT_CHANGED", "The decision amount must exactly match the verified obligation.");
    }
    if (normalizeAddress(decision.payee) !== normalizeAddress(source.payee)) {
      addError("PAYEE_CHANGED", "The decision payee must match the verified vendor destination.");
    }
    if (decision.currency !== source.currency || decision.currency !== state.currency) {
      addError("CURRENCY_CHANGED", "The decision currency must match the obligation and business state.");
    }
    if (source.tokenDecimals !== state.tokenDecimals) {
      addError("TOKEN_DECIMALS_CHANGED", "Token decimals differ from the configured business asset.");
    }
    if (decision.action === "SCHEDULE") {
      if (decision.scheduledFor === null || decision.scheduledFor < today) {
        addError("INVALID_SCHEDULE", "A scheduled decision requires a date that is not in the past.");
      }
    } else if (decision.scheduledFor !== null) {
      addError("INVALID_SCHEDULE", "Only SCHEDULE decisions may contain a scheduled date.");
    }
    if (["PAY_NOW", "PARTIAL_PAY"].includes(decision.action)) {
      immediateSpend += selectedAmount;
      if (selectedAmount > BigInt(state.approvalThresholdMinor) && !approvals.has(decision.obligationId)) {
        addError("APPROVAL_REQUIRED", "The payment exceeds the autonomous approval threshold.");
      }
    }
  }

  const balance = BigInt(state.availableBalanceMinor);
  const reserve = BigInt(state.minimumReserveMinor);
  if (balance - immediateSpend < reserve) {
    errors.push({
      obligationId: null,
      code: "RESERVE_VIOLATION",
      message: "Immediate payments would reduce available balance below the reserve floor.",
    });
  }
  const projected = balance > immediateSpend ? balance - immediateSpend : 0n;
  return PlanValidationResultSchema.parse({
    valid: errors.length === 0,
    projectedImmediateBalanceMinor: projected.toString(),
    errors,
  });
}

