import {
  BusinessStateSchema,
  EvidenceFieldsSchema,
  EvidenceTypeSchema,
  KnownObligationSchema,
  ObligationSchema,
  PaymentDecisionSchema,
  PlanValidationResultSchema,
  SettlementStatusSchema,
  VendorDestinationSchema,
  VendorSchema,
  WitnessPolicySchema,
  WitnessResultSchema,
} from "@euthyna/domain";
import { z } from "zod";

const PilotIdSchema = z.string().regex(/^pilot_[a-z0-9][a-z0-9_-]{2,63}$/);
const PublicIdSchema = z.string().regex(/^real_[a-z0-9][a-z0-9_-]{2,63}$/);
const ConsentDecisionSchema = z.object({
  granted: z.boolean(),
  recordedAt: z.string().datetime({ offset: true }),
  operatorReference: z.string().min(1).max(160),
}).strict();

export const PilotManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  classification: z.literal("REAL"),
  pilotId: PilotIdSchema,
  publicId: PublicIdSchema,
  evaluatedAt: z.string().datetime({ offset: true }),
  privateBusiness: z.object({
    id: z.string().min(1).max(160),
    legalName: z.string().min(1).max(500),
  }).strict(),
  privateVendor: VendorSchema,
  publicAliases: z.object({
    business: z.string().min(1).max(80),
    vendor: z.string().min(1).max(80),
  }).strict(),
  consent: z.object({
    processEvidence: ConsentDecisionSchema,
    publicRedactedMetrics: ConsentDecisionSchema,
    settlement: ConsentDecisionSchema.extend({
      scope: z.enum(["NONE", "ARC_TESTNET", "REAL_USDC"]),
    }).strict(),
  }).strict(),
  publicDisclosure: z.object({
    amount: z.enum(["NONE", "EXACT", "RANGE"]),
    amountRangeLabel: z.string().min(1).max(80).nullable(),
    evidenceRoot: z.boolean(),
    settlementTxHash: z.boolean(),
    includeInAggregateVolume: z.boolean(),
  }).strict(),
  obligation: ObligationSchema,
  verifiedDestination: VendorDestinationSchema.nullable(),
  evidence: z.array(z.object({
    id: z.string().min(1).max(160),
    type: EvidenceTypeSchema,
    relativeFile: z.string().min(1).max(500),
    receivedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }).nullable(),
    issuerName: z.string().min(1).max(500).nullable(),
    mimeType: z.string().min(1).max(160),
    fields: EvidenceFieldsSchema,
  }).strict()).min(1),
  witnessPolicy: WitnessPolicySchema,
  planning: z.object({
    businessState: BusinessStateSchema,
    vendorCriticality: z.number().int().min(1).max(5),
    lateFeeBps: z.number().int().min(0).max(100_000),
    earlyPayDiscountBps: z.number().int().min(0).max(10_000),
    earlyPayDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.pilotId === value.publicId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicId"], message: "Public and private pilot IDs must differ" });
  }
  if (value.privateVendor.businessId !== value.privateBusiness.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["privateVendor", "businessId"], message: "Vendor businessId mismatch" });
  }
  const forbiddenAliases = [value.privateBusiness.id, value.privateBusiness.legalName, value.privateVendor.id, value.privateVendor.legalName]
    .map((item) => item.trim().toLocaleLowerCase());
  for (const [key, alias] of Object.entries(value.publicAliases)) {
    if (forbiddenAliases.includes(alias.trim().toLocaleLowerCase())) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicAliases", key], message: "Public aliases must not repeat private names or IDs" });
    }
  }
  if (value.obligation.businessId !== value.privateBusiness.id || value.obligation.vendorId !== value.privateVendor.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligation"], message: "Obligation business/vendor mismatch" });
  }
  if (value.planning.businessState.businessId !== value.privateBusiness.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["planning", "businessState", "businessId"], message: "Planning businessId mismatch" });
  }
  if (value.obligation.currency !== "USDC" || value.obligation.tokenDecimals !== 6 || value.planning.businessState.currency !== "USDC" || value.planning.businessState.tokenDecimals !== 6) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["obligation", "currency"], message: "The minimal pilot path currently supports 6-decimal USDC only" });
  }
  if (value.verifiedDestination !== null && value.verifiedDestination.vendorId !== value.privateVendor.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["verifiedDestination"], message: "Destination vendorId mismatch" });
  }
  if (value.publicDisclosure.amount === "RANGE" && value.publicDisclosure.amountRangeLabel === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicDisclosure", "amountRangeLabel"], message: "RANGE disclosure requires a label" });
  }
  if (value.consent.settlement.granted && value.consent.settlement.scope === "NONE") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["consent", "settlement", "scope"], message: "Granted settlement consent requires a scope" });
  }
  if (!value.consent.settlement.granted && value.consent.settlement.scope !== "NONE") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["consent", "settlement", "scope"], message: "Settlement scope requires consent" });
  }
});
export type PilotManifest = z.infer<typeof PilotManifestSchema>;

const AgreementAnswerSchema = z.enum(["YES", "NO", "PARTIAL", "NOT_ASKED"]);
export const PilotFeedbackSchema = z.object({
  schemaVersion: z.literal("1"),
  classification: z.literal("REAL"),
  pilotId: PilotIdSchema,
  responseStatus: z.enum(["PENDING", "CAPTURED", "DECLINED"]),
  capturedAt: z.string().datetime({ offset: true }).nullable(),
  witnessAgreement: AgreementAnswerSchema,
  agentAgreement: AgreementAnswerSchema,
  preferredAction: z.enum(["PAY_NOW", "SCHEDULE", "HOLD", "REJECT", "ESCALATE", "NO_ACTION", "NOT_ASKED"]),
  frictionNotesPrivate: z.string().max(5_000),
  wouldUseAgain: z.enum(["YES", "NO", "MAYBE", "NOT_ASKED"]),
}).strict().superRefine((value, context) => {
  if (value.responseStatus === "CAPTURED" && value.capturedAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["capturedAt"], message: "Captured feedback needs a timestamp" });
  }
  if (value.responseStatus !== "CAPTURED" && value.frictionNotesPrivate.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["frictionNotesPrivate"], message: "Notes require CAPTURED status" });
  }
  if (value.responseStatus !== "CAPTURED" && (
    value.witnessAgreement !== "NOT_ASKED" ||
    value.agentAgreement !== "NOT_ASKED" ||
    value.preferredAction !== "NOT_ASKED" ||
    value.wouldUseAgain !== "NOT_ASKED"
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Pending/declined feedback cannot contain invented answers" });
  }
});
export type PilotFeedback = z.infer<typeof PilotFeedbackSchema>;

export const PilotSettlementRecordSchema = z.object({
  schemaVersion: z.literal("1"),
  classification: z.literal("REAL"),
  pilotId: PilotIdSchema,
  scope: z.enum(["ARC_TESTNET", "REAL_USDC"]),
  chainId: z.number().int().positive(),
  network: z.string().min(1).max(100),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/),
  status: SettlementStatusSchema.refine((status) => ["FINAL", "RECONCILED"].includes(status)),
  amountMinor: z.string().regex(/^[1-9][0-9]*$/),
  evidenceRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  autonomous: z.boolean(),
  finalizedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.scope === "ARC_TESTNET" && (value.chainId !== 5_042_002 || value.network !== "Arc Testnet")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["chainId"], message: "ARC_TESTNET settlement must use chain 5042002 / Arc Testnet" });
  }
});
export type PilotSettlementRecord = z.infer<typeof PilotSettlementRecordSchema>;

export const PilotPrivateResultSchema = z.object({
  schemaVersion: z.literal("1"),
  classification: z.literal("REAL"),
  pilotId: PilotIdSchema,
  publicId: PublicIdSchema,
  evaluatedAt: z.string().datetime({ offset: true }),
  manifestHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  evidenceTypes: z.array(EvidenceTypeSchema),
  witness: WitnessResultSchema,
  decision: PaymentDecisionSchema.nullable(),
  validation: PlanValidationResultSchema.nullable(),
  settlementEligible: z.boolean(),
  settlement: PilotSettlementRecordSchema.nullable(),
  knownObligation: KnownObligationSchema,
}).strict();
export type PilotPrivateResult = z.infer<typeof PilotPrivateResultSchema>;

const PublicPilotRecordSchema = z.object({
  publicId: PublicIdSchema,
  classification: z.literal("REAL"),
  businessAlias: z.string().min(1).max(80),
  vendorAlias: z.string().min(1).max(80),
  amount: z.object({ mode: z.enum(["NONE", "EXACT", "RANGE"]), label: z.string().max(80).nullable() }).strict(),
  evidenceTypes: z.array(EvidenceTypeSchema),
  witnessVerdict: z.enum(["VERIFIED", "HOLD", "REJECT"]),
  reasonCode: z.string().nullable(),
  agentDecision: z.enum(["PAY_NOW", "SCHEDULE", "PARTIAL_PAY", "ESCALATE", "NO_ACTION"]).nullable(),
  settlementStatus: z.enum(["NOT_REQUESTED", "CONSENTED_NOT_EXECUTED", "FINAL", "RECONCILED"]),
  evidenceRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();

export const PublicPilotIndexSchema = z.object({
  schemaVersion: z.literal("1"),
  generatedAt: z.string().datetime({ offset: true }).nullable(),
  classification: z.literal("REAL"),
  metrics: z.object({
    businessesOnboarded: z.number().int().nonnegative(),
    obligationsProcessed: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    hold: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    autonomousSettlements: z.number().int().nonnegative(),
    totalPaymentVolumeMinor: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
    currency: z.literal("USDC"),
    duplicatesDetected: z.number().int().nonnegative(),
    payoutChangesDetected: z.number().int().nonnegative(),
    decisions: z.number().int().nonnegative(),
    escalations: z.number().int().nonnegative(),
    humanAgreement: z.object({
      agreed: z.number().int().nonnegative(),
      observed: z.number().int().nonnegative(),
      ratePercent: z.number().min(0).max(100).nullable(),
    }).strict(),
  }).strict(),
  records: z.array(PublicPilotRecordSchema),
}).strict();
export type PublicPilotIndex = z.infer<typeof PublicPilotIndexSchema>;
