import type {
  EvidenceArtifact,
  KnownObligation,
  Obligation,
  Vendor,
  WitnessPolicy,
} from "@euthyna/domain";
import { lineItemFingerprint, obligationFingerprint } from "@euthyna/evidence";
import type { WitnessInput } from "./verify.js";

const DESTINATION = "0x1111111111111111111111111111111111111111";
const EVALUATED_AT = "2026-09-29T12:00:00.000Z";
const items = [{ description: "September design services", amountMinor: "125000000", quantityMinor: "1" }];

export const validObligation: Obligation = {
  id: "obl_valid",
  businessId: "biz_demo",
  vendorId: "vendor_acme",
  invoiceNumber: "INV-1042",
  invoiceDate: "2026-09-25",
  agreementReference: "SOW-2026-09",
  amountMinor: "125000000",
  currency: "USDC",
  tokenDecimals: 6,
  dueDate: "2026-09-30",
  requestedPayoutDestination: DESTINATION,
  partialPaymentAllowed: false,
  status: "EVIDENCE_PENDING",
  lineItems: items,
  settledTxHash: null,
};

export const validVendor: Vendor = {
  id: "vendor_acme",
  businessId: "biz_demo",
  legalName: "Acme Design Ltd",
  normalizedName: "ACME DESIGN LTD",
  status: "ACTIVE",
  currentVersion: 3,
  currentDestination: DESTINATION,
  destinationVerifiedAt: "2026-09-20T09:00:00.000Z",
};

function artifact(
  id: string,
  type: EvidenceArtifact["type"],
  suffix: string,
  fields: EvidenceArtifact["fields"],
): EvidenceArtifact {
  return {
    id,
    businessId: "biz_demo",
    type,
    source: { channel: "UPLOAD", uri: `private://${id}` },
    contentHash: `sha256:${suffix.repeat(64).slice(0, 64)}`,
    mimeType: "application/json",
    parser: { name: "structured-demo", version: "1.0.0" },
    ingestedAt: "2026-09-28T10:00:00.000Z",
    validUntil: null,
    fields,
    fieldProvenance: {},
  };
}

const commonFields: EvidenceArtifact["fields"] = {
  vendorId: "vendor_acme",
  vendorName: "Acme Design Ltd",
  invoiceNumber: null,
  issueDate: null,
  dueDate: null,
  amountMinor: "125000000",
  currency: "USDC",
  tokenDecimals: 6,
  agreementReference: "SOW-2026-09",
  agreementStatus: null,
  agreementStartsOn: null,
  agreementEndsOn: null,
  deliveryAccepted: null,
  payoutDestination: null,
  lineItems: items,
  ambiguousFields: [],
};

export const validArtifacts: EvidenceArtifact[] = [
  artifact("art_invoice", "INVOICE", "a", {
    ...commonFields,
    invoiceNumber: "INV-1042",
    issueDate: "2026-09-25",
    dueDate: "2026-09-30",
    payoutDestination: DESTINATION,
  }),
  artifact("art_agreement", "AGREEMENT", "b", {
    ...commonFields,
    agreementStatus: "ACTIVE",
    agreementStartsOn: "2026-09-01",
    agreementEndsOn: "2026-10-31",
  }),
  artifact("art_delivery", "DELIVERY", "c", {
    ...commonFields,
    amountMinor: null,
    currency: null,
    tokenDecimals: null,
    deliveryAccepted: true,
    lineItems: [],
  }),
];

export const validPolicy: WitnessPolicy = {
  policyVersion: 5,
  requiredEvidenceTypes: ["INVOICE", "AGREEMENT", "DELIVERY"],
  amountToleranceMinor: "0",
  maxEvidenceAgeDays: 30,
};

export function makeValidInput(): WitnessInput {
  return {
    obligation: structuredClone(validObligation),
    vendor: structuredClone(validVendor),
    artifacts: structuredClone(validArtifacts),
    knownObligations: [],
    policy: structuredClone(validPolicy),
    evaluatedAt: EVALUATED_AT,
  };
}

export function knownFrom(
  obligation: Obligation,
  artifacts: EvidenceArtifact[],
  overrides: Partial<KnownObligation> = {},
): KnownObligation {
  return {
    id: "obl_existing",
    businessId: obligation.businessId,
    vendorId: obligation.vendorId,
    fingerprint: obligationFingerprint(obligation),
    amountMinor: obligation.amountMinor,
    currency: obligation.currency,
    dueDate: obligation.dueDate,
    lineItemFingerprint: lineItemFingerprint(obligation.lineItems),
    lineItemCount: obligation.lineItems.length,
    artifactHashes: artifacts.map((item) => item.contentHash),
    status: "VERIFIED",
    settledTxHash: null,
    ...overrides,
  };
}
