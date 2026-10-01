import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluatePilot,
  initializePilot,
  intakeAndEvaluatePilot,
  PILOT_FILENAMES,
  publishPilotIndex,
  recordPilotFeedback,
  recordPilotSettlement,
  validatePilotFeedback,
} from "./pilot.js";
import type { PilotManifest } from "./pilot-schemas.js";

const privateRoots: string[] = [];
const evaluatedAt = "2026-10-01T09:00:00.000Z";
const destination = "0x1111111111111111111111111111111111111111";

afterEach(async () => {
  await Promise.all(privateRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function privateWrite(path: string, value: unknown): Promise<void> {
  await writeFile(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fields(type: "INVOICE" | "AGREEMENT" | "DELIVERY") {
  const common = {
    vendorId: "vendor_private_alpha",
    vendorName: "Confidential Supplier Legal Name",
    invoiceNumber: null,
    issueDate: null,
    dueDate: null,
    amountMinor: "125000000",
    currency: "USDC",
    tokenDecimals: 6,
    agreementReference: "PRIVATE-SOW-7",
    agreementStatus: null,
    agreementStartsOn: null,
    agreementEndsOn: null,
    deliveryAccepted: null,
    payoutDestination: null,
    lineItems: [{ description: "Private professional services", amountMinor: "125000000", quantityMinor: "1" }],
    ambiguousFields: [] as string[],
  };
  if (type === "INVOICE") return { ...common, invoiceNumber: "PRIVATE-INV-9001", issueDate: "2026-09-28", dueDate: "2026-10-01", payoutDestination: destination };
  if (type === "AGREEMENT") return { ...common, agreementStatus: "ACTIVE" as const, agreementStartsOn: "2026-09-01", agreementEndsOn: "2026-12-31" };
  return { ...common, amountMinor: null, currency: null, tokenDecimals: null, deliveryAccepted: true, lineItems: [] };
}

function validManifest(pilotId: string): PilotManifest {
  return {
    schemaVersion: "1",
    classification: "REAL",
    pilotId,
    publicId: "real_pilot_alpha",
    evaluatedAt,
    privateBusiness: { id: "biz_private_alpha", legalName: "Confidential Business Incorporated" },
    privateVendor: {
      id: "vendor_private_alpha",
      businessId: "biz_private_alpha",
      legalName: "Confidential Supplier Legal Name",
      normalizedName: "CONFIDENTIAL SUPPLIER LEGAL NAME",
      status: "ACTIVE",
      currentVersion: 2,
    },
    publicAliases: { business: "Pilot Business A", vendor: "Supplier A" },
    consent: {
      processEvidence: { granted: true, recordedAt: evaluatedAt, operatorReference: "private-consent-process-1" },
      publicRedactedMetrics: { granted: true, recordedAt: evaluatedAt, operatorReference: "private-consent-public-1" },
      settlement: { granted: false, recordedAt: evaluatedAt, operatorReference: "private-consent-settlement-1", scope: "NONE" },
    },
    publicDisclosure: {
      amount: "NONE",
      amountRangeLabel: null,
      evidenceRoot: true,
      settlementTxHash: false,
      includeInAggregateVolume: false,
    },
    obligation: {
      id: "obl_private_alpha",
      businessId: "biz_private_alpha",
      vendorId: "vendor_private_alpha",
      invoiceNumber: "PRIVATE-INV-9001",
      invoiceDate: "2026-09-28",
      agreementReference: "PRIVATE-SOW-7",
      amountMinor: "125000000",
      currency: "USDC",
      tokenDecimals: 6,
      dueDate: "2026-10-01",
      requestedPayoutDestination: destination,
      partialPaymentAllowed: false,
      revisionOfObligationId: null,
      status: "EVIDENCE_PENDING",
      lineItems: [{ description: "Private professional services", amountMinor: "125000000", quantityMinor: "1" }],
      settledTxHash: null,
    },
    verifiedDestination: {
      vendorId: "vendor_private_alpha",
      version: 2,
      chain: "ARC_TESTNET",
      address: destination,
      status: "VERIFIED",
      changeKind: "INITIAL_ONBOARDING",
      verificationMethod: "OWNER_OUT_OF_BAND",
      approvedBy: "private-owner-id",
      approvedAt: "2026-09-25T09:00:00.000Z",
      firstSeenAt: "2026-09-25T08:00:00.000Z",
    },
    evidence: (["INVOICE", "AGREEMENT", "DELIVERY"] as const).map((type) => ({
      id: `private_art_${type.toLowerCase()}`,
      type,
      relativeFile: `evidence/${type.toLowerCase()}.private`,
      receivedAt: "2026-09-30T09:00:00.000Z",
      validUntil: null,
      issuerName: "Confidential Supplier Legal Name",
      mimeType: "application/octet-stream",
      fields: fields(type),
    })),
    witnessPolicy: {
      policyVersion: 1,
      requiredEvidenceTypes: ["INVOICE", "AGREEMENT", "DELIVERY"],
      amountToleranceMinor: "0",
      maxEvidenceAgeDays: 30,
    },
    planning: {
      businessState: {
        businessId: "biz_private_alpha",
        asOf: evaluatedAt,
        availableBalanceMinor: "500000000",
        minimumReserveMinor: "100000000",
        approvalThresholdMinor: "200000000",
        currency: "USDC",
        tokenDecimals: 6,
        expectedInflows: [],
      },
      vendorCriticality: 4,
      lateFeeBps: 0,
      earlyPayDiscountBps: 0,
      earlyPayDeadline: null,
    },
  };
}

async function preparePilot(mutator?: (manifest: PilotManifest) => void) {
  const root = await mkdtemp(join(tmpdir(), "euthyna-pilot-test-"));
  privateRoots.push(root);
  const pilotsRoot = resolve(root, "pilots");
  const pilotId = "pilot_private_alpha";
  const directory = await initializePilot(pilotsRoot, pilotId);
  const manifest = validManifest(pilotId);
  mutator?.(manifest);
  await privateWrite(resolve(directory, PILOT_FILENAMES.manifest), manifest);
  for (const item of manifest.evidence) {
    await privateWrite(resolve(directory, item.relativeFile), `private bytes for ${item.id}: Confidential Business Incorporated`);
  }
  return { root, pilotsRoot, pilotId, directory, manifest };
}

describe("REAL pilot operator workflow", () => {
  it("accepts a private UI intake and evaluates the actual uploaded bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "euthyna-pilot-ui-test-"));
    privateRoots.push(root);
    const pilotsRoot = resolve(root, "pilots");
    const privateBytes = Buffer.from("private source document bytes").toString("base64");
    const relativeDay = (days: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const result = await intakeAndEvaluatePilot(pilotsRoot, {
      privateBusinessLegalName: "Private Buyer Incorporated",
      privateVendorLegalName: "Private Vendor Limited",
      businessAlias: "Pilot Business UI",
      vendorAlias: "Supplier UI",
      invoiceNumber: "INV-REAL-UI-1",
      invoiceDate: relativeDay(0),
      agreementReference: "PO-REAL-UI-1",
      agreementStartsOn: relativeDay(-30),
      agreementEndsOn: relativeDay(365),
      agreementActiveConfirmed: true,
      deliveryAcceptedConfirmed: true,
      amountUsdc: "125.50",
      dueDate: relativeDay(1),
      payoutDestination: destination,
      destinationVerified: true,
      lineItemDescription: "Real pilot service delivery",
      availableBalanceUsdc: "500",
      minimumReserveUsdc: "100",
      approvalThresholdUsdc: "200",
      vendorCriticality: 4,
      processConsent: { granted: true, reference: "private-ui-process-consent" },
      publicMetricsConsent: { granted: false, reference: "not-granted" },
      settlementConsent: { granted: false, reference: "not-granted", scope: "NONE" },
      amountDisclosure: "NONE",
      amountRangeLabel: null,
      discloseEvidenceRoot: false,
      discloseSettlementTxHash: false,
      includeInAggregateVolume: false,
      documents: (["INVOICE", "AGREEMENT", "DELIVERY"] as const).map((type) => ({
        type,
        fileName: `${type.toLowerCase()}.pdf`,
        mimeType: "application/pdf",
        base64: privateBytes,
      })),
    });

    expect(result).toMatchObject({
      classification: "REAL",
      witness: { verdict: "VERIFIED" },
      decision: { action: "PAY_NOW" },
      settlementEligible: false,
      settlementBroadcast: false,
    });
    const evidenceFile = resolve(pilotsRoot, result.pilotId, "evidence", "invoice.pdf");
    expect(await readFile(evidenceFile, "utf8")).toBe("private source document bytes");
    expect((await stat(evidenceFile)).mode & 0o077).toBe(0);
    const feedback = await recordPilotFeedback(pilotsRoot, result.pilotId, {
      witnessAgreement: "YES",
      agentAgreement: "PARTIAL",
      preferredAction: "SCHEDULE",
      frictionNotesPrivate: "The consent reference took time to locate.",
      wouldUseAgain: "MAYBE",
    });
    expect(feedback).toMatchObject({ classification: "REAL", responseStatus: "CAPTURED", agentAgreement: "PARTIAL" });
    expect((await stat(resolve(pilotsRoot, result.pilotId, PILOT_FILENAMES.feedback))).mode & 0o077).toBe(0);
  });

  it("refuses to process evidence without explicit consent", async () => {
    const pilot = await preparePilot((manifest) => { manifest.consent.processEvidence.granted = false; });
    await expect(evaluatePilot(pilot.pilotsRoot, pilot.pilotId)).rejects.toThrow(/consent is not granted/);
  });

  it("preserves W01-W10 and records incomplete REAL evidence as HOLD", async () => {
    const pilot = await preparePilot((manifest) => { manifest.evidence = manifest.evidence.filter((item) => item.type !== "DELIVERY"); });
    const result = await evaluatePilot(pilot.pilotsRoot, pilot.pilotId);
    expect(result.classification).toBe("REAL");
    expect(result.witness).toMatchObject({ verdict: "HOLD", reasonCode: "MISSING_EVIDENCE" });
    expect(result.decision).toBeNull();
    expect(result.settlementEligible).toBe(false);
  });

  it("runs a complete REAL obligation through Witness and bounded Agent", async () => {
    const pilot = await preparePilot();
    const result = await evaluatePilot(pilot.pilotsRoot, pilot.pilotId);
    expect(result.witness.verdict).toBe("VERIFIED");
    expect(result.witness.checks).toHaveLength(10);
    expect(result.witness.checks.every((check) => check.status === "PASS")).toBe(true);
    expect(result.decision?.action).toBe("PAY_NOW");
    expect(result.validation?.valid).toBe(true);
    expect(result.settlementEligible).toBe(false);
  });

  it("publishes only consented aliases, allowlisted proof, and truthful feedback aggregates", async () => {
    const pilot = await preparePilot();
    await evaluatePilot(pilot.pilotsRoot, pilot.pilotId);
    await privateWrite(resolve(pilot.directory, PILOT_FILENAMES.feedback), {
      schemaVersion: "1",
      classification: "REAL",
      pilotId: pilot.pilotId,
      responseStatus: "CAPTURED",
      capturedAt: "2026-10-01T12:00:00.000Z",
      witnessAgreement: "YES",
      agentAgreement: "PARTIAL",
      preferredAction: "SCHEDULE",
      frictionNotesPrivate: "The private contract upload caused friction.",
      wouldUseAgain: "MAYBE",
    });
    expect((await validatePilotFeedback(pilot.pilotsRoot, pilot.pilotId)).responseStatus).toBe("CAPTURED");

    const outputPath = resolve(pilot.root, "public-index.json");
    const index = await publishPilotIndex(pilot.pilotsRoot, outputPath);
    expect(index.metrics).toMatchObject({
      businessesOnboarded: 1,
      obligationsProcessed: 1,
      verified: 1,
      hold: 0,
      rejected: 0,
      decisions: 1,
      escalations: 1,
      humanAgreement: { agreed: 1, observed: 2, ratePercent: 50 },
    });
    expect(index.records[0]).toMatchObject({
      publicId: "real_pilot_alpha",
      businessAlias: "Pilot Business A",
      vendorAlias: "Supplier A",
      amount: { mode: "NONE", label: null },
      witnessVerdict: "VERIFIED",
      agentDecision: "PAY_NOW",
    });
    const serialized = await readFile(outputPath, "utf8");
    for (const forbidden of [
      "Confidential Business Incorporated",
      "Confidential Supplier Legal Name",
      "PRIVATE-INV-9001",
      destination,
      "private-consent-public-1",
      "The private contract upload caused friction.",
      "invoice.private",
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("binds an optional settlement only after scoped consent and exact result matching", async () => {
    const pilot = await preparePilot((manifest) => {
      manifest.consent.settlement = {
        granted: true,
        recordedAt: evaluatedAt,
        operatorReference: "private-consent-settlement-yes",
        scope: "ARC_TESTNET",
      };
      manifest.publicDisclosure.settlementTxHash = true;
      manifest.publicDisclosure.includeInAggregateVolume = true;
    });
    const evaluated = await evaluatePilot(pilot.pilotsRoot, pilot.pilotId);
    expect(evaluated.settlementEligible).toBe(true);
    const txHash = `0x${"a".repeat(64)}`;
    await privateWrite(resolve(pilot.directory, PILOT_FILENAMES.settlement), {
      schemaVersion: "1",
      classification: "REAL",
      pilotId: pilot.pilotId,
      scope: "ARC_TESTNET",
      chainId: 5_042_002,
      network: "Arc Testnet",
      txHash,
      blockNumber: "65000000",
      status: "RECONCILED",
      amountMinor: pilot.manifest.obligation.amountMinor,
      evidenceRoot: evaluated.witness.evidenceRoot,
      autonomous: true,
      finalizedAt: "2026-10-01T10:00:00.000Z",
    });
    const recorded = await recordPilotSettlement(pilot.pilotsRoot, pilot.pilotId);
    expect(recorded.settlement?.txHash).toBe(txHash);
    expect(recorded.knownObligation).toMatchObject({ status: "SETTLED", settledTxHash: txHash });
  });

  it("keeps the public index at honest zero/N/A when no pilot consent exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "euthyna-empty-pilot-test-"));
    privateRoots.push(root);
    const outputPath = resolve(root, "public-index.json");
    const index = await publishPilotIndex(resolve(root, "pilots"), outputPath);
    expect(index.generatedAt).toBeNull();
    expect(index.records).toEqual([]);
    expect(index.metrics).toMatchObject({ obligationsProcessed: 0, totalPaymentVolumeMinor: "0", humanAgreement: { observed: 0, ratePercent: null } });
  });
});
