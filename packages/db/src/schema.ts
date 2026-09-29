import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = (name: string) => text(name).notNull();
const money = (name: string) => numeric(name, { precision: 78, scale: 0, mode: "string" }).notNull();
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const classificationEnum = pgEnum("classification", ["REAL", "TEST"]);
export const environmentEnum = pgEnum("environment", ["LOCAL", "ARC_TESTNET", "ARC_MAINNET"]);
export const vendorStatusEnum = pgEnum("vendor_status", ["PENDING_ONBOARDING", "ACTIVE", "PENDING_CHANGE", "SUSPENDED"]);
export const destinationStatusEnum = pgEnum("destination_status", ["PROPOSED", "VERIFIED", "SUPERSEDED"]);
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "INVOICE",
  "AGREEMENT",
  "DELIVERY",
  "VENDOR_IDENTITY",
  "PAYMENT_INSTRUCTION",
  "HUMAN_ATTESTATION",
  "CREDIT_NOTE",
]);
export const obligationStatusEnum = pgEnum("obligation_status", [
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
export const witnessVerdictEnum = pgEnum("witness_verdict", ["VERIFIED", "HOLD", "REJECT"]);
export const paymentActionEnum = pgEnum("payment_action", [
  "PAY_NOW",
  "SCHEDULE",
  "PARTIAL_PAY",
  "ESCALATE",
  "NO_ACTION",
]);
export const paymentStateEnum = pgEnum("payment_state", [
  "PROPOSED",
  "POLICY_VALIDATED",
  "ATTESTED",
  "SIMULATED",
  "SIGNED",
  "SUBMITTED",
  "SETTLED",
  "ESCALATED",
  "APPROVED",
  "CANCELLED",
  "EXPIRED",
]);
export const settlementStatusEnum = pgEnum("settlement_status", [
  "PREPARED",
  "SUBMITTED",
  "FINAL",
  "REVERTED",
  "RECONCILED",
]);

export const businesses = pgTable("businesses", {
  id: id("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  baseCurrency: text("base_currency").notNull(),
  tokenDecimals: integer("token_decimals").notNull(),
  minimumReserveMinor: money("minimum_reserve_minor"),
  perPaymentCapMinor: money("per_payment_cap_minor"),
  approvalThresholdMinor: money("approval_threshold_minor"),
  policyVersion: bigint("policy_version", { mode: "number" }).notNull().default(1),
  environment: environmentEnum("environment").notNull(),
  classification: classificationEnum("classification").notNull(),
  createdAt: createdAt(),
});

export const vendors = pgTable(
  "vendors",
  {
    id: id("id").primaryKey(),
    businessId: id("business_id").references(() => businesses.id).notNull(),
    legalName: text("legal_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: vendorStatusEnum("status").notNull(),
    currentVersion: bigint("current_version", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("vendors_business_idx").on(table.businessId)],
);

export const vendorDestinations = pgTable(
  "vendor_destinations",
  {
    vendorId: id("vendor_id").references(() => vendors.id).notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    chain: text("chain").notNull(),
    address: text("address").notNull(),
    verificationMethod: text("verification_method").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }).notNull(),
    status: destinationStatusEnum("status").notNull(),
    changeKind: text("change_kind").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.vendorId, table.version] }),
    uniqueIndex("vendor_destination_version_address_uq").on(table.vendorId, table.version, table.address),
  ],
);

export const evidenceArtifacts = pgTable(
  "evidence_artifacts",
  {
    id: id("id").primaryKey(),
    businessId: id("business_id").references(() => businesses.id).notNull(),
    type: evidenceTypeEnum("type").notNull(),
    sourceUri: text("source_uri").notNull(),
    sourceChannel: text("source_channel").notNull(),
    issuerId: text("issuer_id"),
    issuerName: text("issuer_name"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
    contentHash: text("content_hash").notNull(),
    normalizedContentHash: text("normalized_content_hash").notNull(),
    rawArtifactHash: text("raw_artifact_hash").notNull(),
    relevantIdentifiersJson: jsonb("relevant_identifiers_json").notNull(),
    relationshipsJson: jsonb("relationships_json").notNull(),
    provenanceMetadataJson: jsonb("provenance_metadata_json").notNull(),
    mimeType: text("mime_type").notNull(),
    parserName: text("parser_name").notNull(),
    parserVersion: text("parser_version").notNull(),
    extractedJson: jsonb("extracted_json").notNull(),
    provenanceJson: jsonb("provenance_json").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "string" }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "string" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("evidence_business_hash_uq").on(table.businessId, table.contentHash),
    index("evidence_business_type_idx").on(table.businessId, table.type),
  ],
);

export const obligations = pgTable(
  "obligations",
  {
    id: id("id").primaryKey(),
    businessId: id("business_id").references(() => businesses.id).notNull(),
    vendorId: id("vendor_id").references(() => vendors.id).notNull(),
    invoiceKey: text("invoice_key").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    agreementReference: text("agreement_reference").notNull(),
    amountMinor: money("amount_minor"),
    currency: text("currency").notNull(),
    tokenDecimals: integer("token_decimals").notNull(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    requestedPayout: text("requested_payout").notNull(),
    partialPaymentAllowed: boolean("partial_payment_allowed").notNull().default(false),
    revisionOfObligationId: text("revision_of_obligation_id"),
    status: obligationStatusEnum("status").notNull(),
    classification: classificationEnum("classification").notNull(),
    settledTx: text("settled_tx"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("obligations_business_invoice_key_uq").on(table.businessId, table.invoiceKey),
    index("obligations_business_status_idx").on(table.businessId, table.status),
  ],
);

export const obligationEvidence = pgTable(
  "obligation_evidence",
  {
    obligationId: id("obligation_id").references(() => obligations.id).notNull(),
    artifactId: id("artifact_id").references(() => evidenceArtifacts.id).notNull(),
    role: text("role").notNull(),
    required: boolean("required").notNull(),
    matchResult: jsonb("match_result").notNull(),
  },
  (table) => [primaryKey({ columns: [table.obligationId, table.artifactId, table.role] })],
);

export const witnessRuns = pgTable(
  "witness_runs",
  {
    id: id("id").primaryKey(),
    obligationId: id("obligation_id").references(() => obligations.id).notNull(),
    vendorVersion: bigint("vendor_version", { mode: "number" }).notNull(),
    policyVersion: bigint("policy_version", { mode: "number" }).notNull(),
    evidenceRoot: text("evidence_root").notNull(),
    verdict: witnessVerdictEnum("verdict").notNull(),
    reasonCode: text("reason_code"),
    checksJson: jsonb("checks_json").notNull(),
    signerVersion: text("signer_version"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("witness_obligation_created_idx").on(table.obligationId, table.createdAt)],
);

export const paymentPlans = pgTable(
  "payment_plans",
  {
    id: id("id").primaryKey(),
    businessId: id("business_id").references(() => businesses.id).notNull(),
    businessStateHash: text("business_state_hash").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    decisionsJson: jsonb("decisions_json").notNull(),
    assumptionsJson: jsonb("assumptions_json").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("plans_business_created_idx").on(table.businessId, table.createdAt)],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: id("id").primaryKey(),
    planId: id("plan_id").references(() => paymentPlans.id).notNull(),
    obligationId: id("obligation_id").references(() => obligations.id).notNull(),
    action: paymentActionEnum("action").notNull(),
    amountMinor: money("amount_minor"),
    currency: text("currency").notNull(),
    payee: text("payee").notNull(),
    scheduledFor: date("scheduled_for", { mode: "string" }),
    state: paymentStateEnum("state").notNull(),
    policyVersion: bigint("policy_version", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("intent_plan_obligation_uq").on(table.planId, table.obligationId)],
);

export const attestations = pgTable(
  "attestations",
  {
    id: id("id").primaryKey(),
    intentId: id("intent_id").references(() => paymentIntents.id).notNull(),
    operationId: text("operation_id").notNull(),
    typedDataHash: text("typed_data_hash").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "string" }).notNull(),
    witnessSignature: text("witness_signature").notNull(),
    signerVersion: text("signer_version").notNull(),
    vendorVersion: bigint("vendor_version", { mode: "number" }).notNull(),
    policyVersion: bigint("policy_version", { mode: "number" }).notNull(),
    witnessVersion: bigint("witness_version", { mode: "number" }).notNull(),
    rulesVersion: bigint("rules_version", { mode: "number" }).notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    verifyingContract: text("verifying_contract").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("attestation_intent_uq").on(table.intentId),
    uniqueIndex("attestation_operation_uq").on(table.operationId),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id("id").primaryKey(),
    intentId: id("intent_id").references(() => paymentIntents.id).notNull(),
    chainId: bigint("chain_id", { mode: "number" }).notNull(),
    chain: text("chain").notNull(),
    txHash: text("tx_hash").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "string" }),
    blockNumber: numeric("block_number", { precision: 78, scale: 0, mode: "string" }),
    status: settlementStatusEnum("status").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("settlement_intent_uq").on(table.intentId),
    uniqueIndex("settlement_chain_tx_uq").on(table.chainId, table.txHash),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    businessId: id("business_id").references(() => businesses.id).notNull(),
    entityType: text("entity_type").notNull(),
    entityId: id("entity_id"),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    previousState: text("previous_state"),
    newState: text("new_state"),
    reasonCode: text("reason_code"),
    payloadJson: jsonb("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("audit_business_created_idx").on(table.businessId, table.createdAt)],
);

export const feedbackEvents = pgTable("feedback_events", {
  id: uuid("id").primaryKey(),
  businessId: id("business_id").references(() => businesses.id).notNull(),
  userId: id("user_id"),
  decisionId: id("decision_id"),
  agreed: boolean("agreed").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});
