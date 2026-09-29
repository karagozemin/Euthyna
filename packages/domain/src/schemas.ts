import { z } from "zod";

export const IdentifierSchema = z.string().min(1).max(160);
export const MinorUnitStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "money must be an unsigned base-10 integer string");
export const CurrencySchema = z.string().regex(/^[A-Z][A-Z0-9]{2,11}$/);
export const Hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const MoneySchema = z.object({
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  tokenDecimals: z.number().int().min(0).max(36),
});
export type Money = z.infer<typeof MoneySchema>;

export const EvidenceTypeSchema = z.enum([
  "INVOICE",
  "AGREEMENT",
  "DELIVERY",
  "VENDOR_IDENTITY",
  "PAYMENT_INSTRUCTION",
  "HUMAN_ATTESTATION",
  "CREDIT_NOTE",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const SourceChannelSchema = z.enum([
  "UPLOAD",
  "EMAIL",
  "API",
  "WEBHOOK",
  "OWNER",
  "SYSTEM",
]);

export const FieldProvenanceSchema = z.object({
  artifactId: IdentifierSchema,
  sourceSpan: z.string().max(2_000).nullable(),
  extractor: z.string().min(1),
  extractorVersion: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
});

export const LineItemSchema = z.object({
  description: z.string().min(1).max(1_000),
  amountMinor: MinorUnitStringSchema,
  quantityMinor: MinorUnitStringSchema.nullable().default(null),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const EvidenceFieldsSchema = z.object({
  vendorId: IdentifierSchema.nullable().default(null),
  vendorName: z.string().min(1).max(500).nullable().default(null),
  invoiceNumber: z.string().min(1).max(160).nullable().default(null),
  issueDate: IsoDateSchema.nullable().default(null),
  dueDate: IsoDateSchema.nullable().default(null),
  amountMinor: MinorUnitStringSchema.nullable().default(null),
  currency: CurrencySchema.nullable().default(null),
  tokenDecimals: z.number().int().min(0).max(36).nullable().default(null),
  agreementReference: z.string().min(1).max(300).nullable().default(null),
  agreementStatus: z.enum(["ACTIVE", "EXPIRED", "CANCELLED"]).nullable().default(null),
  agreementStartsOn: IsoDateSchema.nullable().default(null),
  agreementEndsOn: IsoDateSchema.nullable().default(null),
  deliveryAccepted: z.boolean().nullable().default(null),
  payoutDestination: AddressSchema.nullable().default(null),
  lineItems: z.array(LineItemSchema).default([]),
  ambiguousFields: z.array(z.string().min(1)).default([]),
});
export type EvidenceFields = z.infer<typeof EvidenceFieldsSchema>;

export const EvidenceArtifactSchema = z.object({
  id: IdentifierSchema,
  businessId: IdentifierSchema,
  type: EvidenceTypeSchema,
  source: z.object({
    channel: SourceChannelSchema,
    uri: z.string().min(1),
  }),
  contentHash: z.string().regex(/^(sha256:|keccak256:)[0-9a-fA-F]{64}$/),
  mimeType: z.string().min(1),
  parser: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  ingestedAt: IsoDateTimeSchema,
  validUntil: IsoDateTimeSchema.nullable().default(null),
  fields: EvidenceFieldsSchema,
  fieldProvenance: z.record(FieldProvenanceSchema).default({}),
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const VendorSchema = z.object({
  id: IdentifierSchema,
  businessId: IdentifierSchema,
  legalName: z.string().min(1).max(500),
  normalizedName: z.string().min(1).max(500),
  status: z.enum(["ACTIVE", "PENDING_CHANGE", "SUSPENDED"]),
  currentVersion: z.number().int().positive(),
  currentDestination: AddressSchema,
  destinationVerifiedAt: IsoDateTimeSchema,
});
export type Vendor = z.infer<typeof VendorSchema>;

export const ObligationStatusSchema = z.enum([
  "INGESTED",
  "NORMALIZED",
  "EVIDENCE_PENDING",
  "VERIFIED",
  "HOLD",
  "REJECTED",
  "PLANNED",
  "AUTHORIZED",
  "SUBMITTED",
  "SETTLED",
]);

export const ObligationSchema = z.object({
  id: IdentifierSchema,
  businessId: IdentifierSchema,
  vendorId: IdentifierSchema,
  invoiceNumber: z.string().min(1).max(160),
  invoiceDate: IsoDateSchema,
  agreementReference: z.string().min(1).max(300),
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  tokenDecimals: z.number().int().min(0).max(36),
  dueDate: IsoDateSchema,
  requestedPayoutDestination: AddressSchema,
  partialPaymentAllowed: z.boolean().default(false),
  status: ObligationStatusSchema,
  lineItems: z.array(LineItemSchema).default([]),
  settledTxHash: Hex32Schema.nullable().default(null),
});
export type Obligation = z.infer<typeof ObligationSchema>;

export const KnownObligationSchema = z.object({
  id: IdentifierSchema,
  businessId: IdentifierSchema,
  vendorId: IdentifierSchema,
  fingerprint: Hex32Schema,
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  dueDate: IsoDateSchema,
  lineItemFingerprint: Hex32Schema,
  lineItemCount: z.number().int().min(0),
  artifactHashes: z.array(z.string().regex(/^(sha256:|keccak256:)[0-9a-fA-F]{64}$/)),
  status: ObligationStatusSchema,
  settledTxHash: Hex32Schema.nullable(),
});
export type KnownObligation = z.infer<typeof KnownObligationSchema>;

export const WitnessReasonCodeSchema = z.enum([
  "MISSING_EVIDENCE",
  "VENDOR_MISMATCH",
  "AMOUNT_MISMATCH",
  "AGREEMENT_INVALID",
  "DELIVERY_UNVERIFIED",
  "DUPLICATE_OBLIGATION",
  "DESTINATION_CHANGED",
  "ALREADY_SETTLED",
  "STALE_EVIDENCE",
  "AMBIGUOUS_FIELD",
]);
export type WitnessReasonCode = z.infer<typeof WitnessReasonCodeSchema>;

export const WitnessCheckIdSchema = z.enum([
  "W01",
  "W02",
  "W03",
  "W04",
  "W05",
  "W06",
  "W07",
  "W08",
  "W09",
  "W10",
]);
export type WitnessCheckId = z.infer<typeof WitnessCheckIdSchema>;

export const WitnessCheckSchema = z.object({
  id: WitnessCheckIdSchema,
  name: z.string().min(1),
  status: z.enum(["PASS", "FAIL"]),
  disposition: z.enum(["NONE", "HOLD", "REJECT"]),
  reasonCode: WitnessReasonCodeSchema.nullable(),
  expected: z.unknown().nullable(),
  observed: z.unknown().nullable(),
  relatedArtifactIds: z.array(IdentifierSchema),
});
export type WitnessCheck = z.infer<typeof WitnessCheckSchema>;

export const WitnessPolicySchema = z.object({
  policyVersion: z.number().int().positive(),
  requiredEvidenceTypes: z.array(EvidenceTypeSchema).min(1),
  amountToleranceMinor: MinorUnitStringSchema,
  maxEvidenceAgeDays: z.number().int().positive(),
});
export type WitnessPolicy = z.infer<typeof WitnessPolicySchema>;

export const WitnessResultSchema = z.object({
  obligationId: IdentifierSchema,
  verdict: z.enum(["VERIFIED", "HOLD", "REJECT"]),
  reasonCode: WitnessReasonCodeSchema.nullable(),
  vendorVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  evidenceRoot: Hex32Schema,
  checks: z.array(WitnessCheckSchema).length(10),
  requiredAction: z.string().nullable(),
  evaluatedAt: IsoDateTimeSchema,
});
export type WitnessResult = z.infer<typeof WitnessResultSchema>;

export const DecisionActionSchema = z.enum([
  "PAY_NOW",
  "SCHEDULE",
  "PARTIAL_PAY",
  "ESCALATE",
  "NO_ACTION",
]);
export type DecisionAction = z.infer<typeof DecisionActionSchema>;

export const PlannerReasonCodeSchema = z.enum([
  "DUE_OR_OVERDUE",
  "DUE_SOON",
  "CRITICAL_VENDOR",
  "EARLY_PAY_DISCOUNT",
  "PRESERVE_RESERVE",
  "EXPECTED_INFLOW",
  "APPROVAL_REQUIRED",
  "INSUFFICIENT_LIQUIDITY",
  "LOWER_PRIORITY",
]);
export type PlannerReasonCode = z.infer<typeof PlannerReasonCodeSchema>;

export const PlanningObligationSchema = z.object({
  obligationId: IdentifierSchema,
  vendorId: IdentifierSchema,
  witnessVerdict: z.enum(["VERIFIED", "HOLD", "REJECT"]),
  evidenceRoot: Hex32Schema,
  vendorVersion: z.number().int().positive(),
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  tokenDecimals: z.number().int().min(0).max(36),
  payee: AddressSchema,
  dueDate: IsoDateSchema,
  vendorCriticality: z.number().int().min(1).max(5),
  lateFeeBps: z.number().int().min(0).max(100_000),
  earlyPayDiscountBps: z.number().int().min(0).max(10_000),
  earlyPayDeadline: IsoDateSchema.nullable(),
  partialPaymentAllowed: z.boolean(),
});
export type PlanningObligation = z.infer<typeof PlanningObligationSchema>;

export const BusinessStateSchema = z.object({
  businessId: IdentifierSchema,
  asOf: IsoDateTimeSchema,
  availableBalanceMinor: MinorUnitStringSchema,
  minimumReserveMinor: MinorUnitStringSchema,
  approvalThresholdMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  tokenDecimals: z.number().int().min(0).max(36),
  expectedInflows: z.array(
    z.object({
      id: IdentifierSchema,
      expectedOn: IsoDateSchema,
      amountMinor: MinorUnitStringSchema,
      confidenceBps: z.number().int().min(0).max(10_000),
    }),
  ),
});
export type BusinessState = z.infer<typeof BusinessStateSchema>;

export const PaymentDecisionSchema = z.object({
  obligationId: IdentifierSchema,
  action: DecisionActionSchema,
  amountMinor: MinorUnitStringSchema,
  currency: CurrencySchema,
  payee: AddressSchema,
  scheduledFor: IsoDateSchema.nullable(),
  reasonCodes: z.array(PlannerReasonCodeSchema).min(1),
  rationale: z.string().min(1).max(2_000),
  confidenceBps: z.number().int().min(0).max(10_000),
});
export type PaymentDecision = z.infer<typeof PaymentDecisionSchema>;

export const PaymentPlanSchema = z.object({
  planId: IdentifierSchema,
  businessId: IdentifierSchema,
  businessStateHash: Hex32Schema,
  agent: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    version: z.string().min(1),
  }),
  decisions: z.array(PaymentDecisionSchema),
  assumptions: z.array(z.string().min(1)),
  createdAt: IsoDateTimeSchema,
});
export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;

export const PlanValidationErrorCodeSchema = z.enum([
  "UNKNOWN_OBLIGATION",
  "OBLIGATION_NOT_VERIFIED",
  "DUPLICATE_DECISION",
  "AMOUNT_CHANGED",
  "PARTIAL_PAYMENT_NOT_ALLOWED",
  "PAYEE_CHANGED",
  "CURRENCY_CHANGED",
  "TOKEN_DECIMALS_CHANGED",
  "RESERVE_VIOLATION",
  "APPROVAL_REQUIRED",
  "INVALID_SCHEDULE",
]);
export type PlanValidationErrorCode = z.infer<typeof PlanValidationErrorCodeSchema>;

export const PlanValidationResultSchema = z.object({
  valid: z.boolean(),
  projectedImmediateBalanceMinor: MinorUnitStringSchema,
  errors: z.array(
    z.object({
      obligationId: IdentifierSchema.nullable(),
      code: PlanValidationErrorCodeSchema,
      message: z.string().min(1),
    }),
  ),
});
export type PlanValidationResult = z.infer<typeof PlanValidationResultSchema>;

export const WitnessAttestationSchema = z.object({
  obligationId: Hex32Schema,
  businessIdHash: Hex32Schema,
  vendorIdHash: Hex32Schema,
  payee: AddressSchema,
  token: AddressSchema,
  amountMinor: MinorUnitStringSchema,
  evidenceRoot: Hex32Schema,
  receiptHash: Hex32Schema,
  vendorVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  validUntilUnix: MinorUnitStringSchema,
});
export type WitnessAttestation = z.infer<typeof WitnessAttestationSchema>;

export const SettlementStatusSchema = z.enum([
  "PREPARED",
  "SUBMITTED",
  "FINAL",
  "REVERTED",
  "RECONCILED",
]);

export const SettlementSchema = z.object({
  chainId: z.number().int().positive(),
  network: z.string().min(1),
  txHash: Hex32Schema,
  blockNumber: MinorUnitStringSchema,
  status: SettlementStatusSchema,
  explorerUrl: z.string().url(),
  finalizedAt: IsoDateTimeSchema,
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const DecisionReceiptBodySchema = z.object({
  receiptId: IdentifierSchema,
  businessId: IdentifierSchema,
  vendorId: IdentifierSchema,
  obligationId: IdentifierSchema,
  classification: z.enum(["REAL", "TEST"]),
  agent: z.object({
    planId: IdentifierSchema,
    action: DecisionActionSchema,
    reasonCodes: z.array(PlannerReasonCodeSchema),
    rationale: z.string().min(1),
    businessStateHash: Hex32Schema,
    provider: z.string().min(1),
    model: z.string().min(1),
    version: z.string().min(1),
  }),
  witness: z.object({
    verdict: z.enum(["VERIFIED", "HOLD", "REJECT"]),
    reasonCode: WitnessReasonCodeSchema.nullable(),
    evidenceRoot: Hex32Schema,
    checks: z.array(WitnessCheckSchema).length(10),
    vendorVersion: z.number().int().positive(),
  }),
  authorization: z.object({
    policyVersion: z.number().int().positive(),
    attestationHash: Hex32Schema.nullable(),
    validUntil: IsoDateTimeSchema.nullable(),
    signerVersion: z.string().nullable(),
  }),
  settlement: SettlementSchema.nullable(),
  humanAction: z
    .object({
      actor: IdentifierSchema,
      action: z.string().min(1),
      occurredAt: IsoDateTimeSchema,
    })
    .nullable(),
  createdAt: IsoDateTimeSchema,
});
export type DecisionReceiptBody = z.infer<typeof DecisionReceiptBodySchema>;

export const DecisionReceiptSchema = DecisionReceiptBodySchema.extend({
  receiptHash: Hex32Schema,
});
export type DecisionReceipt = z.infer<typeof DecisionReceiptSchema>;
