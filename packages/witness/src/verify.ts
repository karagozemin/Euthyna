import {
  EvidenceArtifactSchema,
  KnownObligationSchema,
  ObligationSchema,
  VendorDestinationSchema,
  VendorSchema,
  WitnessPolicySchema,
  WitnessResultSchema,
  type EvidenceArtifact,
  type EvidenceType,
  type KnownObligation,
  type Obligation,
  type Vendor,
  type VendorDestination,
  type WitnessCheck,
  type WitnessCheckId,
  type WitnessPolicy,
  type WitnessReasonCode,
  type WitnessResult,
} from "@euthyna/domain";
import {
  evidenceRoot,
  lineItemFingerprint,
  normalizeAddress,
  normalizeIdentifier,
  obligationFingerprint,
} from "@euthyna/evidence";
import { z } from "zod";

const WitnessInputSchema = z.object({
  obligation: ObligationSchema,
  vendor: VendorSchema,
  vendorDestination: VendorDestinationSchema.nullable(),
  artifacts: z.array(EvidenceArtifactSchema),
  knownObligations: z.array(KnownObligationSchema),
  policy: WitnessPolicySchema,
  evaluatedAt: z.string().datetime({ offset: true }),
});

export interface WitnessInput {
  obligation: Obligation;
  vendor: Vendor;
  vendorDestination: VendorDestination | null;
  artifacts: EvidenceArtifact[];
  knownObligations: KnownObligation[];
  policy: WitnessPolicy;
  evaluatedAt: string;
}

const CHECK_NAMES: Record<WitnessCheckId, string> = {
  W01: "Required evidence classes are present",
  W02: "Vendor identity matches agreement and invoice",
  W03: "Currency and amount match within policy tolerance",
  W04: "Agreement reference is valid and active",
  W05: "Delivery or service acceptance satisfies release condition",
  W06: "Obligation is not a semantic duplicate",
  W07: "Payout destination matches the current verified destination",
  W08: "Obligation has not already settled",
  W09: "Evidence timestamps and versions are fresh",
  W10: "Required payment fields are resolved and unambiguous",
};

const REQUIRED_ACTION: Record<WitnessReasonCode, string> = {
  MISSING_EVIDENCE: "PROVIDE_REQUIRED_EVIDENCE",
  VENDOR_MISMATCH: "CORRECT_VENDOR_OR_CREATE_NEW_OBLIGATION",
  AMOUNT_MISMATCH: "RESOLVE_AMOUNT_OR_CURRENCY_MISMATCH",
  AGREEMENT_INVALID: "PROVIDE_ACTIVE_AGREEMENT",
  DELIVERY_UNVERIFIED: "PROVIDE_DELIVERY_ACCEPTANCE",
  DUPLICATE_OBLIGATION: "REVIEW_ORIGINAL_OBLIGATION",
  DESTINATION_CHANGED: "OWNER_REVERIFY_VENDOR_DESTINATION",
  DESTINATION_UNVERIFIED: "OWNER_VERIFY_INITIAL_VENDOR_DESTINATION",
  ALREADY_SETTLED: "REVIEW_ORIGINAL_SETTLEMENT",
  STALE_EVIDENCE: "REFRESH_EVIDENCE",
  AMBIGUOUS_FIELD: "RESOLVE_REQUIRED_FIELDS",
};

function pass(id: WitnessCheckId, artifactIds: string[] = []): WitnessCheck {
  return {
    id,
    name: CHECK_NAMES[id],
    status: "PASS",
    disposition: "NONE",
    reasonCode: null,
    expected: null,
    observed: null,
    relatedArtifactIds: artifactIds,
  };
}

function fail(
  id: WitnessCheckId,
  disposition: "HOLD" | "REJECT",
  reasonCode: WitnessReasonCode,
  expected: unknown,
  observed: unknown,
  relatedArtifactIds: string[] = [],
): WitnessCheck {
  return {
    id,
    name: CHECK_NAMES[id],
    status: "FAIL",
    disposition,
    reasonCode,
    expected,
    observed,
    relatedArtifactIds,
  };
}

function artifactsOf(artifacts: EvidenceArtifact[], type: EvidenceType): EvidenceArtifact[] {
  return artifacts.filter((artifact) => artifact.type === type);
}

function absoluteDifference(left: string, right: string): bigint {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -difference : difference;
}

function checkW01(artifacts: EvidenceArtifact[], policy: WitnessPolicy): WitnessCheck {
  const present = new Set(artifacts.map((artifact) => artifact.type));
  const missing = [...new Set(policy.requiredEvidenceTypes)].filter((type) => !present.has(type));
  return missing.length === 0
    ? pass("W01", artifacts.map((artifact) => artifact.id))
    : fail("W01", "HOLD", "MISSING_EVIDENCE", policy.requiredEvidenceTypes, missing);
}

function checkW02(
  obligation: Obligation,
  vendor: Vendor,
  artifacts: EvidenceArtifact[],
): WitnessCheck {
  const relevant = artifacts.filter((artifact) =>
    ["INVOICE", "AGREEMENT", "VENDOR_IDENTITY"].includes(artifact.type),
  );
  const observedVendorIds = relevant
    .map((artifact) => artifact.fields.vendorId)
    .filter((value): value is string => value !== null);
  const mismatches = observedVendorIds.filter(
    (id) => normalizeIdentifier(id) !== normalizeIdentifier(obligation.vendorId),
  );
  const masterMismatch =
    normalizeIdentifier(vendor.id) !== normalizeIdentifier(obligation.vendorId) ||
    vendor.businessId !== obligation.businessId;
  return mismatches.length === 0 && !masterMismatch
    ? pass("W02", relevant.map((artifact) => artifact.id))
    : fail(
        "W02",
        "REJECT",
        "VENDOR_MISMATCH",
        { vendorId: obligation.vendorId, businessId: obligation.businessId },
        { artifactVendorIds: observedVendorIds, masterVendorId: vendor.id, masterBusinessId: vendor.businessId },
        relevant.map((artifact) => artifact.id),
      );
}

function checkW03(
  obligation: Obligation,
  artifacts: EvidenceArtifact[],
  policy: WitnessPolicy,
): WitnessCheck {
  const relevant = artifacts.filter((artifact) => ["INVOICE", "AGREEMENT"].includes(artifact.type));
  const mismatches = relevant.flatMap((artifact) => {
    const reasons: string[] = [];
    if (artifact.fields.currency !== null && artifact.fields.currency !== obligation.currency) {
      reasons.push("CURRENCY");
    }
    if (
      artifact.fields.tokenDecimals !== null &&
      artifact.fields.tokenDecimals !== obligation.tokenDecimals
    ) {
      reasons.push("TOKEN_DECIMALS");
    }
    if (
      artifact.fields.amountMinor !== null &&
      absoluteDifference(artifact.fields.amountMinor, obligation.amountMinor) >
        BigInt(policy.amountToleranceMinor)
    ) {
      reasons.push("AMOUNT");
    }
    return reasons.length === 0 ? [] : [{ artifactId: artifact.id, reasons }];
  });
  return mismatches.length === 0
    ? pass("W03", relevant.map((artifact) => artifact.id))
    : fail(
        "W03",
        "HOLD",
        "AMOUNT_MISMATCH",
        {
          amountMinor: obligation.amountMinor,
          currency: obligation.currency,
          tokenDecimals: obligation.tokenDecimals,
          toleranceMinor: policy.amountToleranceMinor,
        },
        mismatches,
        relevant.map((artifact) => artifact.id),
      );
}

function checkW04(
  obligation: Obligation,
  artifacts: EvidenceArtifact[],
  evaluatedAt: string,
): WitnessCheck {
  const agreements = artifactsOf(artifacts, "AGREEMENT");
  const day = evaluatedAt.slice(0, 10);
  const valid = agreements.find((artifact) => {
    const fields = artifact.fields;
    return (
      fields.agreementReference !== null &&
      normalizeIdentifier(fields.agreementReference) ===
        normalizeIdentifier(obligation.agreementReference) &&
      fields.agreementStatus === "ACTIVE" &&
      (fields.agreementStartsOn === null || fields.agreementStartsOn <= day) &&
      (fields.agreementEndsOn === null || fields.agreementEndsOn >= day)
    );
  });
  return valid
    ? pass("W04", [valid.id])
    : fail(
        "W04",
        "HOLD",
        "AGREEMENT_INVALID",
        { reference: obligation.agreementReference, status: "ACTIVE", activeOn: day },
        agreements.map((artifact) => ({
          artifactId: artifact.id,
          reference: artifact.fields.agreementReference,
          status: artifact.fields.agreementStatus,
          startsOn: artifact.fields.agreementStartsOn,
          endsOn: artifact.fields.agreementEndsOn,
        })),
        agreements.map((artifact) => artifact.id),
      );
}

function checkW05(obligation: Obligation, artifacts: EvidenceArtifact[]): WitnessCheck {
  const delivery = artifactsOf(artifacts, "DELIVERY");
  const accepted = delivery.find(
    (artifact) =>
      artifact.fields.deliveryAccepted === true &&
      artifact.fields.agreementReference !== null &&
      normalizeIdentifier(artifact.fields.agreementReference) ===
        normalizeIdentifier(obligation.agreementReference),
  );
  return accepted
    ? pass("W05", [accepted.id])
    : fail(
        "W05",
        "HOLD",
        "DELIVERY_UNVERIFIED",
        { agreementReference: obligation.agreementReference, deliveryAccepted: true },
        delivery.map((artifact) => ({
          artifactId: artifact.id,
          agreementReference: artifact.fields.agreementReference,
          deliveryAccepted: artifact.fields.deliveryAccepted,
        })),
        delivery.map((artifact) => artifact.id),
      );
}

function checkW06(
  obligation: Obligation,
  artifacts: EvidenceArtifact[],
  known: KnownObligation[],
): WitnessCheck {
  const fingerprint = obligationFingerprint(obligation);
  const artifactHashes = new Set(artifacts.map((artifact) => artifact.contentHash.toLowerCase()));
  const exact = known.find(
    (candidate) =>
      candidate.id !== obligation.id &&
      (candidate.fingerprint.toLowerCase() === fingerprint.toLowerCase() ||
        candidate.artifactHashes.some((hash) => artifactHashes.has(hash.toLowerCase()))),
  );
  if (exact) {
    return fail(
      "W06",
      "REJECT",
      "DUPLICATE_OBLIGATION",
      { uniqueFingerprint: fingerprint },
      { matchedObligationId: exact.id, matchedFingerprint: exact.fingerprint },
    );
  }

  const sameInvoiceIdentity = known.find(
    (candidate) =>
      candidate.id !== obligation.id &&
      candidate.businessId === obligation.businessId &&
      candidate.vendorId === obligation.vendorId &&
      normalizeIdentifier(candidate.invoiceNumber) === normalizeIdentifier(obligation.invoiceNumber) &&
      candidate.amountMinor === obligation.amountMinor &&
      candidate.currency === obligation.currency &&
      !(obligation.revisionOfObligationId === candidate.id && candidate.status === "REJECTED"),
  );
  if (sameInvoiceIdentity) {
    return fail(
      "W06",
      "HOLD",
      "DUPLICATE_OBLIGATION",
      { uniqueInvoiceIdentity: true },
      { matchedObligationId: sameInvoiceIdentity.id, match: "VENDOR_INVOICE_NUMBER_AMOUNT" },
    );
  }

  const itemFingerprint = lineItemFingerprint(obligation.lineItems);
  const near = known.find(
    (candidate) =>
      candidate.id !== obligation.id &&
      !(obligation.revisionOfObligationId === candidate.id && candidate.status === "REJECTED") &&
      obligation.lineItems.length > 0 &&
      candidate.lineItemCount > 0 &&
      candidate.businessId === obligation.businessId &&
      candidate.vendorId === obligation.vendorId &&
      candidate.amountMinor === obligation.amountMinor &&
      candidate.currency === obligation.currency &&
      candidate.dueDate === obligation.dueDate &&
      candidate.lineItemFingerprint.toLowerCase() === itemFingerprint.toLowerCase(),
  );
  return near
    ? fail(
        "W06",
        "HOLD",
        "DUPLICATE_OBLIGATION",
        { uniqueBusinessObligation: true },
        { nearDuplicateObligationId: near.id },
      )
    : pass("W06");
}

function checkW07(
  obligation: Obligation,
  vendor: Vendor,
  destination: VendorDestination | null,
  artifacts: EvidenceArtifact[],
): WitnessCheck {
  const instructionArtifacts = artifacts.filter((artifact) =>
    ["INVOICE", "PAYMENT_INSTRUCTION"].includes(artifact.type),
  );
  const observedDestinations = instructionArtifacts
    .map((artifact) => artifact.fields.payoutDestination)
    .filter((value): value is string => value !== null);
  if (destination === null || vendor.status === "PENDING_ONBOARDING" || destination.status !== "VERIFIED") {
    return fail(
      "W07",
      "HOLD",
      "DESTINATION_UNVERIFIED",
      { verifiedDestinationRequired: true },
      {
        requestedDestination: obligation.requestedPayoutDestination,
        vendorStatus: vendor.status,
        proposedDestination: destination?.address ?? null,
        changeKind: destination?.changeKind ?? "INITIAL_ONBOARDING",
      },
      instructionArtifacts.map((artifact) => artifact.id),
    );
  }
  const expected = normalizeAddress(destination.address);
  const changed =
    vendor.status !== "ACTIVE" ||
    normalizeAddress(obligation.requestedPayoutDestination) !== expected ||
    observedDestinations.some((destination) => normalizeAddress(destination) !== expected);
  return changed
    ? fail(
        "W07",
        "HOLD",
        "DESTINATION_CHANGED",
        { destination: destination.address, vendorVersion: destination.version, status: "ACTIVE" },
        {
          requestedDestination: obligation.requestedPayoutDestination,
          evidenceDestinations: observedDestinations,
          vendorStatus: vendor.status,
        },
        instructionArtifacts.map((artifact) => artifact.id),
      )
    : pass("W07", instructionArtifacts.map((artifact) => artifact.id));
}

function checkW08(obligation: Obligation, known: KnownObligation[]): WitnessCheck {
  const fingerprint = obligationFingerprint(obligation);
  const settled = known.find(
    (candidate) =>
      candidate.fingerprint.toLowerCase() === fingerprint.toLowerCase() &&
      (candidate.status === "SETTLED" || candidate.settledTxHash !== null),
  );
  const alreadySettled =
    obligation.status === "SETTLED" || obligation.settledTxHash !== null || settled !== undefined;
  return alreadySettled
    ? fail(
        "W08",
        "REJECT",
        "ALREADY_SETTLED",
        { settled: false },
        {
          obligationStatus: obligation.status,
          txHash: obligation.settledTxHash ?? settled?.settledTxHash ?? null,
          matchedObligationId: settled?.id ?? obligation.id,
        },
      )
    : pass("W08");
}

function checkW09(
  artifacts: EvidenceArtifact[],
  policy: WitnessPolicy,
  evaluatedAt: string,
): WitnessCheck {
  const now = new Date(evaluatedAt).getTime();
  const maximumAge = policy.maxEvidenceAgeDays * 24 * 60 * 60 * 1_000;
  const stale = artifacts.filter((artifact) => {
    const ingested = new Date(artifact.ingestedAt).getTime();
    const expired = artifact.validUntil !== null && new Date(artifact.validUntil).getTime() < now;
    return expired || now - ingested > maximumAge || ingested > now;
  });
  return stale.length === 0
    ? pass("W09", artifacts.map((artifact) => artifact.id))
    : fail(
        "W09",
        "HOLD",
        "STALE_EVIDENCE",
        { maxEvidenceAgeDays: policy.maxEvidenceAgeDays, evaluatedAt },
        stale.map((artifact) => ({
          artifactId: artifact.id,
          ingestedAt: artifact.ingestedAt,
          validUntil: artifact.validUntil,
        })),
        stale.map((artifact) => artifact.id),
      );
}

function checkW10(obligation: Obligation, artifacts: EvidenceArtifact[]): WitnessCheck {
  const ambiguous = artifacts.flatMap((artifact) =>
    artifact.fields.ambiguousFields.map((field) => ({ artifactId: artifact.id, field })),
  );
  const unresolved: string[] = [];
  if (obligation.invoiceNumber.trim() === "") unresolved.push("invoiceNumber");
  if (obligation.agreementReference.trim() === "") unresolved.push("agreementReference");
  if (BigInt(obligation.amountMinor) <= 0n) unresolved.push("amountMinor");
  const requiredByType: Partial<Record<EvidenceType, Array<keyof EvidenceArtifact["fields"]>>> = {
    INVOICE: [
      "vendorId",
      "invoiceNumber",
      "issueDate",
      "dueDate",
      "amountMinor",
      "currency",
      "tokenDecimals",
      "agreementReference",
      "payoutDestination",
    ],
    AGREEMENT: [
      "vendorId",
      "amountMinor",
      "currency",
      "tokenDecimals",
      "agreementReference",
      "agreementStatus",
    ],
    DELIVERY: ["vendorId", "agreementReference", "deliveryAccepted"],
  };
  for (const artifact of artifacts) {
    for (const field of requiredByType[artifact.type] ?? []) {
      if (artifact.fields[field] === null) unresolved.push(`${artifact.id}.${field}`);
    }
  }
  return ambiguous.length === 0 && unresolved.length === 0
    ? pass("W10", artifacts.map((artifact) => artifact.id))
    : fail(
        "W10",
        "HOLD",
        "AMBIGUOUS_FIELD",
        { requiredFieldsResolved: true },
        { ambiguous, unresolved: [...new Set(unresolved)].sort() },
        ambiguous.map((entry) => entry.artifactId),
      );
}

export function verifyObligation(rawInput: WitnessInput): WitnessResult {
  const input = WitnessInputSchema.parse(rawInput);
  const { obligation, vendor, artifacts, knownObligations, policy, evaluatedAt } = input;
  const checks: WitnessCheck[] = [
    checkW01(artifacts, policy),
    checkW02(obligation, vendor, artifacts),
    checkW03(obligation, artifacts, policy),
    checkW04(obligation, artifacts, evaluatedAt),
    checkW05(obligation, artifacts),
    checkW06(obligation, artifacts, knownObligations),
    checkW07(obligation, vendor, input.vendorDestination, artifacts),
    checkW08(obligation, knownObligations),
    checkW09(artifacts, policy, evaluatedAt),
    checkW10(obligation, artifacts),
  ];
  const rejection = checks.find((check) => check.disposition === "REJECT");
  const hold = checks.find((check) => check.disposition === "HOLD");
  const primaryFailure = rejection ?? hold;
  const verdict = rejection ? "REJECT" : hold ? "HOLD" : "VERIFIED";
  const reasonCode = primaryFailure?.reasonCode ?? null;
  return WitnessResultSchema.parse({
    obligationId: obligation.id,
    verdict,
    reasonCode,
    vendorVersion: vendor.currentVersion,
    policyVersion: policy.policyVersion,
    evidenceRoot: evidenceRoot(artifacts, checks),
    checks,
    requiredAction: reasonCode === null ? null : REQUIRED_ACTION[reasonCode],
    evaluatedAt,
  });
}
