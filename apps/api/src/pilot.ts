import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type {
  EvidenceArtifact,
  EvidenceType,
  KnownObligation,
  PlanningObligation,
} from "@euthyna/domain";
import {
  canonicalJson,
  lineItemFingerprint,
  obligationFingerprint,
  sha256Hex,
} from "@euthyna/evidence";
import { BoundedDecisionAgent, validatePaymentPlan } from "@euthyna/planner";
import { verifyObligation } from "@euthyna/witness";
import {
  PilotFeedbackSchema,
  PilotManifestSchema,
  PilotPrivateResultSchema,
  PilotSettlementRecordSchema,
  PilotUiFeedbackInputSchema,
  PilotUiIntakeSchema,
  PublicPilotIndexSchema,
  type PilotFeedback,
  type PilotManifest,
  type PilotPrivateResult,
  type PilotSettlementRecord,
  type PilotUiIntake,
  type PublicPilotIndex,
} from "./pilot-schemas.js";

export const PILOT_FILENAMES = {
  manifest: "manifest.private.json",
  feedback: "feedback.private.json",
  settlement: "settlement.private.json",
  result: "result.private.json",
} as const;

const PILOT_ID_PATTERN = /^pilot_[a-z0-9][a-z0-9_-]{2,63}$/;
const PRIVATE_MODE_MASK = 0o077;
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

function usdcMinor(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}${fraction.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "");
}

function safeExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "text/plain": "txt",
  };
  return extensions[mimeType] ?? "bin";
}

function assertPilotId(pilotId: string): void {
  if (!PILOT_ID_PATTERN.test(pilotId)) throw new Error("Pilot ID must match pilot_[a-z0-9_-]");
}

export function pilotDirectory(pilotsRoot: string, pilotId: string): string {
  assertPilotId(pilotId);
  const root = resolve(pilotsRoot);
  const directory = resolve(root, pilotId);
  if (!directory.startsWith(`${root}${sep}`)) throw new Error("Pilot directory escaped the private root");
  return directory;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertPrivateFile(path: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Private input must be a regular non-symlink file: ${basename(path)}`);
  if ((stats.mode & PRIVATE_MODE_MASK) !== 0) throw new Error(`Private input must be chmod 600 (or stricter): ${basename(path)}`);
}

async function readPrivateJson(path: string): Promise<unknown> {
  await assertPrivateFile(path);
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writePrivateJson(path: string, value: unknown, exclusive = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: exclusive ? "wx" : "w" });
  await chmod(path, 0o600);
}

async function writePublicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, path);
}

function privateTemplate(pilotId: string): unknown {
  return {
    schemaVersion: "1",
    classification: "REAL",
    pilotId,
    publicId: "REPLACE_WITH_real_public_alias_id",
    evaluatedAt: null,
    privateBusiness: { id: null, legalName: null },
    privateVendor: {
      id: null,
      businessId: null,
      legalName: null,
      normalizedName: null,
      status: "ACTIVE",
      currentVersion: 1,
    },
    publicAliases: { business: null, vendor: null },
    consent: {
      processEvidence: { granted: false, recordedAt: null, operatorReference: null },
      publicRedactedMetrics: { granted: false, recordedAt: null, operatorReference: null },
      settlement: { granted: false, recordedAt: null, operatorReference: null, scope: "NONE" },
    },
    publicDisclosure: {
      amount: "NONE",
      amountRangeLabel: null,
      evidenceRoot: false,
      settlementTxHash: false,
      includeInAggregateVolume: false,
    },
    obligation: {
      id: null,
      businessId: null,
      vendorId: null,
      invoiceNumber: null,
      invoiceDate: null,
      agreementReference: null,
      amountMinor: null,
      currency: "USDC",
      tokenDecimals: 6,
      dueDate: null,
      requestedPayoutDestination: null,
      partialPaymentAllowed: false,
      revisionOfObligationId: null,
      status: "EVIDENCE_PENDING",
      lineItems: [],
      settledTxHash: null,
    },
    verifiedDestination: null,
    evidence: [],
    witnessPolicy: {
      policyVersion: 1,
      requiredEvidenceTypes: ["INVOICE", "AGREEMENT", "DELIVERY"],
      amountToleranceMinor: "0",
      maxEvidenceAgeDays: 30,
    },
    planning: {
      businessState: {
        businessId: null,
        asOf: null,
        availableBalanceMinor: null,
        minimumReserveMinor: null,
        approvalThresholdMinor: null,
        currency: "USDC",
        tokenDecimals: 6,
        expectedInflows: [],
      },
      vendorCriticality: 3,
      lateFeeBps: 0,
      earlyPayDiscountBps: 0,
      earlyPayDeadline: null,
    },
  };
}

export async function initializePilot(pilotsRoot: string, pilotId: string): Promise<string> {
  const directory = pilotDirectory(pilotsRoot, pilotId);
  await mkdir(resolve(directory, "evidence"), { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await chmod(resolve(directory, "evidence"), 0o700);
  await writePrivateJson(resolve(directory, PILOT_FILENAMES.manifest), privateTemplate(pilotId), true);
  await writePrivateJson(resolve(directory, PILOT_FILENAMES.feedback), {
    schemaVersion: "1",
    classification: "REAL",
    pilotId,
    responseStatus: "PENDING",
    capturedAt: null,
    witnessAgreement: "NOT_ASKED",
    agentAgreement: "NOT_ASKED",
    preferredAction: "NOT_ASKED",
    frictionNotesPrivate: "",
    wouldUseAgain: "NOT_ASKED",
  }, true);
  await writeFile(resolve(directory, "README.private.txt"), [
    "PRIVATE PILOT DIRECTORY — NEVER COMMIT",
    "1. Put source files under evidence/ and chmod 600 each file.",
    "2. Complete manifest.private.json using operator-confirmed normalized fields.",
    "3. Record consent truthfully. Evaluation refuses without processing consent.",
    "4. Run the pilot evaluate command. Incomplete evidence must remain HOLD.",
    "5. Complete feedback.private.json after the business responds.",
    "6. Publish only if redacted-metrics consent is granted.",
    "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
  return directory;
}

async function loadManifest(directory: string): Promise<PilotManifest> {
  return PilotManifestSchema.parse(await readPrivateJson(resolve(directory, PILOT_FILENAMES.manifest)));
}

async function resolveEvidenceFile(directory: string, relativeFile: string): Promise<string> {
  if (relativeFile.startsWith("/") || relativeFile.includes("..")) throw new Error("Evidence paths must stay under evidence/");
  const evidenceDirectory = resolve(directory, "evidence");
  const requested = resolve(directory, relativeFile);
  if (!requested.startsWith(`${evidenceDirectory}${sep}`)) throw new Error("Evidence paths must stay under evidence/");
  await assertPrivateFile(requested);
  const [realDirectory, realRequested] = await Promise.all([realpath(evidenceDirectory), realpath(requested)]);
  if (!realRequested.startsWith(`${realDirectory}${sep}`)) throw new Error("Evidence symlink/path escaped the private pilot directory");
  const stats = await lstat(realRequested);
  if (stats.size > MAX_EVIDENCE_BYTES) throw new Error(`Evidence file exceeds 25 MiB: ${basename(requested)}`);
  return realRequested;
}

function fileSha256(buffer: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function relationshipFor(type: EvidenceType, agreementReference: string) {
  if (type === "INVOICE") return [{ relation: "GOVERNED_BY" as const, targetType: "AGREEMENT", targetId: agreementReference }];
  if (type === "DELIVERY") return [{ relation: "FULFILLS" as const, targetType: "OBLIGATION", targetId: agreementReference }];
  if (type === "PAYMENT_INSTRUCTION") return [{ relation: "INSTRUCTS_PAYMENT" as const, targetType: "VENDOR", targetId: agreementReference }];
  return [];
}

async function buildArtifacts(directory: string, manifest: PilotManifest): Promise<EvidenceArtifact[]> {
  const artifacts: EvidenceArtifact[] = [];
  for (const source of manifest.evidence) {
    const sourcePath = await resolveEvidenceFile(directory, source.relativeFile);
    const raw = await readFile(sourcePath);
    const rawHash = fileSha256(raw);
    const normalizedHash = `sha256:${sha256Hex(canonicalJson(source.fields)).slice(2)}` as const;
    artifacts.push({
      id: source.id,
      businessId: manifest.privateBusiness.id,
      type: source.type,
      source: { channel: "UPLOAD", uri: `private://${manifest.pilotId}/${source.id}` },
      issuer: { id: manifest.privateVendor.id, name: source.issuerName },
      receivedAt: source.receivedAt,
      contentHash: rawHash,
      normalizedContentHash: normalizedHash,
      rawArtifactHash: rawHash,
      relevantIdentifiers: {
        obligationId: manifest.obligation.id,
        agreementReference: manifest.obligation.agreementReference,
      },
      relationships: relationshipFor(source.type, manifest.obligation.agreementReference),
      provenanceMetadata: { classification: "REAL", operatorAssisted: true },
      mimeType: source.mimeType,
      parser: { name: "operator-confirmed", version: "1.0.0" },
      ingestedAt: source.receivedAt,
      validUntil: source.validUntil,
      fields: source.fields,
      fieldProvenance: {},
    });
  }
  return artifacts;
}

async function loadKnownObligations(pilotsRoot: string, currentPilotId: string): Promise<KnownObligation[]> {
  if (!(await pathExists(pilotsRoot))) return [];
  const entries = await readdir(pilotsRoot, { withFileTypes: true });
  const known: KnownObligation[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === currentPilotId || !PILOT_ID_PATTERN.test(entry.name)) continue;
    const resultPath = resolve(pilotsRoot, entry.name, PILOT_FILENAMES.result);
    if (!(await pathExists(resultPath))) continue;
    const parsed = PilotPrivateResultSchema.parse(await readPrivateJson(resultPath));
    known.push(parsed.knownObligation);
  }
  return known;
}

function resultStatus(verdict: "VERIFIED" | "HOLD" | "REJECT"): "VERIFIED" | "HOLD" | "REJECTED" {
  return verdict === "REJECT" ? "REJECTED" : verdict;
}

export async function evaluatePilot(pilotsRoot: string, pilotId: string): Promise<PilotPrivateResult> {
  const directory = pilotDirectory(pilotsRoot, pilotId);
  const manifest = await loadManifest(directory);
  if (manifest.pilotId !== pilotId) throw new Error("Manifest pilotId does not match directory");
  if (!manifest.consent.processEvidence.granted) throw new Error("Evidence-processing consent is not granted");
  if (manifest.obligation.status !== "EVIDENCE_PENDING") throw new Error("New pilot obligation must begin EVIDENCE_PENDING");

  const artifacts = await buildArtifacts(directory, manifest);
  const knownObligations = await loadKnownObligations(pilotsRoot, pilotId);
  const witness = verifyObligation({
    obligation: manifest.obligation,
    vendor: manifest.privateVendor,
    vendorDestination: manifest.verifiedDestination,
    artifacts,
    knownObligations,
    policy: manifest.witnessPolicy,
    evaluatedAt: manifest.evaluatedAt,
  });

  const planningObligation: PlanningObligation = {
    obligationId: manifest.obligation.id,
    vendorId: manifest.privateVendor.id,
    witnessVerdict: witness.verdict,
    evidenceRoot: witness.evidenceRoot,
    vendorVersion: witness.vendorVersion,
    amountMinor: manifest.obligation.amountMinor,
    currency: manifest.obligation.currency,
    tokenDecimals: manifest.obligation.tokenDecimals,
    payee: manifest.obligation.requestedPayoutDestination,
    dueDate: manifest.obligation.dueDate,
    vendorCriticality: manifest.planning.vendorCriticality,
    lateFeeBps: manifest.planning.lateFeeBps,
    earlyPayDiscountBps: manifest.planning.earlyPayDiscountBps,
    earlyPayDeadline: manifest.planning.earlyPayDeadline,
    partialPaymentAllowed: manifest.obligation.partialPaymentAllowed,
  };

  let decision: PilotPrivateResult["decision"] = null;
  let validation: PilotPrivateResult["validation"] = null;
  if (witness.verdict === "VERIFIED") {
    const context = { state: manifest.planning.businessState, obligations: [planningObligation] };
    const plan = await new BoundedDecisionAgent().createPlan(context);
    validation = validatePaymentPlan(plan, context);
    if (!validation.valid) throw new Error("Decision Agent output failed deterministic validation");
    decision = plan.decisions[0] ?? null;
    if (decision === null) throw new Error("VERIFIED obligation produced no Agent decision");
  }

  const settlementEligible = Boolean(
    witness.verdict === "VERIFIED" &&
    validation?.valid &&
    decision?.action === "PAY_NOW" &&
    manifest.consent.settlement.granted &&
    manifest.consent.settlement.scope !== "NONE",
  );
  const knownObligation: KnownObligation = {
    id: manifest.obligation.id,
    businessId: manifest.obligation.businessId,
    vendorId: manifest.obligation.vendorId,
    invoiceNumber: manifest.obligation.invoiceNumber,
    invoiceDate: manifest.obligation.invoiceDate,
    fingerprint: obligationFingerprint(manifest.obligation),
    amountMinor: manifest.obligation.amountMinor,
    currency: manifest.obligation.currency,
    dueDate: manifest.obligation.dueDate,
    lineItemFingerprint: lineItemFingerprint(manifest.obligation.lineItems),
    lineItemCount: manifest.obligation.lineItems.length,
    artifactHashes: artifacts.map((artifact) => artifact.contentHash),
    status: resultStatus(witness.verdict),
    settledTxHash: null,
  };
  const result = PilotPrivateResultSchema.parse({
    schemaVersion: "1",
    classification: "REAL",
    pilotId,
    publicId: manifest.publicId,
    evaluatedAt: manifest.evaluatedAt,
    manifestHash: sha256Hex(canonicalJson(manifest)),
    evidenceTypes: [...new Set(artifacts.map((artifact) => artifact.type))].sort(),
    witness,
    decision,
    validation,
    settlementEligible,
    settlement: null,
    knownObligation,
  });
  await writePrivateJson(resolve(directory, PILOT_FILENAMES.result), result, true);
  return result;
}

export interface PilotUiResult {
  classification: "REAL";
  pilotId: string;
  publicId: string;
  privateStorage: string;
  evidenceTypes: EvidenceType[];
  witness: PilotPrivateResult["witness"];
  decision: PilotPrivateResult["decision"];
  validation: PilotPrivateResult["validation"];
  settlementEligible: boolean;
  settlementConsentScope: "NONE" | "ARC_TESTNET" | "REAL_USDC";
  settlementBroadcast: false;
}

export async function intakeAndEvaluatePilot(pilotsRoot: string, rawInput: unknown): Promise<PilotUiResult> {
  const input: PilotUiIntake = PilotUiIntakeSchema.parse(rawInput);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const pilotId = `pilot_${suffix}`;
  const publicId = `real_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const businessId = `biz_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const vendorId = `vendor_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const obligationId = `obl_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const evaluatedAt = new Date().toISOString();
  const amountMinor = usdcMinor(input.amountUsdc);
  const lineItems = [{ description: input.lineItemDescription, amountMinor, quantityMinor: "1" }];
  const directory = await initializePilot(pilotsRoot, pilotId);

  const evidence: PilotManifest["evidence"] = [];
  for (const document of input.documents) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(document.base64)) throw new Error(`Invalid base64 for ${document.type}`);
    const bytes = Buffer.from(document.base64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) throw new Error(`${document.type} must be between 1 byte and 25 MiB`);
    const relativeFile = `evidence/${document.type.toLowerCase()}.${safeExtension(document.mimeType)}`;
    await writeFile(resolve(directory, relativeFile), bytes, { mode: 0o600, flag: "wx" });
    await chmod(resolve(directory, relativeFile), 0o600);

    const commonFields = {
      vendorId,
      vendorName: input.privateVendorLegalName,
      invoiceNumber: null,
      issueDate: null,
      dueDate: null,
      amountMinor: null,
      currency: null,
      tokenDecimals: null,
      agreementReference: input.agreementReference,
      agreementStatus: null,
      agreementStartsOn: null,
      agreementEndsOn: null,
      deliveryAccepted: null,
      payoutDestination: null,
      lineItems: [] as typeof lineItems,
      ambiguousFields: [] as string[],
    };
    const fields = document.type === "INVOICE"
      ? {
          ...commonFields,
          invoiceNumber: input.invoiceNumber,
          issueDate: input.invoiceDate,
          dueDate: input.dueDate,
          amountMinor,
          currency: "USDC",
          tokenDecimals: 6,
          payoutDestination: input.payoutDestination,
          lineItems,
        }
      : document.type === "AGREEMENT"
        ? {
            ...commonFields,
            amountMinor,
            currency: "USDC",
            tokenDecimals: 6,
            agreementStatus: input.agreementActiveConfirmed ? "ACTIVE" as const : "CANCELLED" as const,
            agreementStartsOn: input.agreementStartsOn,
            agreementEndsOn: input.agreementEndsOn,
            lineItems,
          }
        : document.type === "DELIVERY"
          ? { ...commonFields, deliveryAccepted: input.deliveryAcceptedConfirmed }
          : { ...commonFields, payoutDestination: input.payoutDestination };
    evidence.push({
      id: `artifact_${document.type.toLowerCase()}_${suffix}`,
      type: document.type,
      relativeFile,
      receivedAt: evaluatedAt,
      validUntil: null,
      issuerName: input.privateVendorLegalName,
      mimeType: document.mimeType,
      fields,
    });
  }

  const consentAt = evaluatedAt;
  const manifest: PilotManifest = {
    schemaVersion: "1",
    classification: "REAL",
    pilotId,
    publicId,
    evaluatedAt,
    privateBusiness: { id: businessId, legalName: input.privateBusinessLegalName },
    privateVendor: {
      id: vendorId,
      businessId,
      legalName: input.privateVendorLegalName,
      normalizedName: input.privateVendorLegalName.normalize("NFKC").trim().toLocaleUpperCase(),
      status: "ACTIVE",
      currentVersion: 1,
    },
    publicAliases: { business: input.businessAlias, vendor: input.vendorAlias },
    consent: {
      processEvidence: { granted: true, recordedAt: consentAt, operatorReference: input.processConsent.reference },
      publicRedactedMetrics: { granted: input.publicMetricsConsent.granted, recordedAt: consentAt, operatorReference: input.publicMetricsConsent.reference },
      settlement: {
        granted: input.settlementConsent.granted,
        recordedAt: consentAt,
        operatorReference: input.settlementConsent.reference,
        scope: input.settlementConsent.scope,
      },
    },
    publicDisclosure: {
      amount: input.publicMetricsConsent.granted ? input.amountDisclosure : "NONE",
      amountRangeLabel: input.publicMetricsConsent.granted && input.amountDisclosure === "RANGE" ? input.amountRangeLabel : null,
      evidenceRoot: input.publicMetricsConsent.granted && input.discloseEvidenceRoot,
      settlementTxHash: input.publicMetricsConsent.granted && input.discloseSettlementTxHash,
      includeInAggregateVolume: input.publicMetricsConsent.granted && input.includeInAggregateVolume,
    },
    obligation: {
      id: obligationId,
      businessId,
      vendorId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      agreementReference: input.agreementReference,
      amountMinor,
      currency: "USDC",
      tokenDecimals: 6,
      dueDate: input.dueDate,
      requestedPayoutDestination: input.payoutDestination,
      partialPaymentAllowed: false,
      revisionOfObligationId: null,
      status: "EVIDENCE_PENDING",
      lineItems,
      settledTxHash: null,
    },
    verifiedDestination: input.destinationVerified
      ? {
          vendorId,
          version: 1,
          chain: input.settlementConsent.scope === "REAL_USDC" ? "ARC" : "ARC_TESTNET",
          address: input.payoutDestination,
          status: "VERIFIED",
          changeKind: "INITIAL_ONBOARDING",
          verificationMethod: "OPERATOR_OUT_OF_BAND",
          approvedBy: "private_operator",
          approvedAt: evaluatedAt,
          firstSeenAt: evaluatedAt,
        }
      : null,
    evidence,
    witnessPolicy: {
      policyVersion: 1,
      requiredEvidenceTypes: ["INVOICE", "AGREEMENT", "DELIVERY"],
      amountToleranceMinor: "0",
      maxEvidenceAgeDays: 30,
    },
    planning: {
      businessState: {
        businessId,
        asOf: evaluatedAt,
        availableBalanceMinor: usdcMinor(input.availableBalanceUsdc),
        minimumReserveMinor: usdcMinor(input.minimumReserveUsdc),
        approvalThresholdMinor: usdcMinor(input.approvalThresholdUsdc),
        currency: "USDC",
        tokenDecimals: 6,
        expectedInflows: [],
      },
      vendorCriticality: input.vendorCriticality,
      lateFeeBps: 0,
      earlyPayDiscountBps: 0,
      earlyPayDeadline: null,
    },
  };

  const validatedManifest = PilotManifestSchema.parse(manifest);
  await writePrivateJson(resolve(directory, PILOT_FILENAMES.manifest), validatedManifest);
  const result = await evaluatePilot(pilotsRoot, pilotId);
  return {
    classification: "REAL",
    pilotId,
    publicId,
    privateStorage: `.euthyna/pilots/${pilotId}`,
    evidenceTypes: result.evidenceTypes,
    witness: result.witness,
    decision: result.decision,
    validation: result.validation,
    settlementEligible: result.settlementEligible,
    settlementConsentScope: input.settlementConsent.scope,
    settlementBroadcast: false,
  };
}

export async function validatePilotFeedback(pilotsRoot: string, pilotId: string): Promise<PilotFeedback> {
  const directory = pilotDirectory(pilotsRoot, pilotId);
  const feedback = PilotFeedbackSchema.parse(await readPrivateJson(resolve(directory, PILOT_FILENAMES.feedback)));
  if (feedback.pilotId !== pilotId) throw new Error("Feedback pilotId does not match directory");
  return feedback;
}

export async function recordPilotFeedback(pilotsRoot: string, pilotId: string, rawInput: unknown): Promise<PilotFeedback> {
  const directory = pilotDirectory(pilotsRoot, pilotId);
  if (!(await pathExists(resolve(directory, PILOT_FILENAMES.result)))) throw new Error("Pilot must be evaluated before feedback is recorded");
  const input = PilotUiFeedbackInputSchema.parse(rawInput);
  const feedback = PilotFeedbackSchema.parse({
    schemaVersion: "1",
    classification: "REAL",
    pilotId,
    responseStatus: "CAPTURED",
    capturedAt: new Date().toISOString(),
    ...input,
  });
  await writePrivateJson(resolve(directory, PILOT_FILENAMES.feedback), feedback);
  return feedback;
}

export async function recordPilotSettlement(pilotsRoot: string, pilotId: string): Promise<PilotPrivateResult> {
  const directory = pilotDirectory(pilotsRoot, pilotId);
  const [manifest, result, settlement] = await Promise.all([
    loadManifest(directory),
    readPrivateJson(resolve(directory, PILOT_FILENAMES.result)).then((value) => PilotPrivateResultSchema.parse(value)),
    readPrivateJson(resolve(directory, PILOT_FILENAMES.settlement)).then((value) => PilotSettlementRecordSchema.parse(value)),
  ]);
  if (!manifest.consent.settlement.granted || manifest.consent.settlement.scope === "NONE") throw new Error("Settlement consent is not granted");
  if (sha256Hex(canonicalJson(manifest)) !== result.manifestHash) throw new Error("Manifest changed after evaluation; settlement is refused");
  if (!result.settlementEligible) throw new Error("Witness/Agent result is not eligible for settlement");
  if (settlement.pilotId !== pilotId || settlement.scope !== manifest.consent.settlement.scope) throw new Error("Settlement scope/pilot mismatch");
  if (settlement.amountMinor !== manifest.obligation.amountMinor) throw new Error("Settlement amount does not match verified obligation");
  if (settlement.evidenceRoot.toLowerCase() !== result.witness.evidenceRoot.toLowerCase()) throw new Error("Settlement evidence root mismatch");
  if (settlement.autonomous && result.decision?.action !== "PAY_NOW") throw new Error("Autonomous settlement requires PAY_NOW");
  if (result.settlement !== null) {
    if (result.settlement.txHash.toLowerCase() !== settlement.txHash.toLowerCase()) throw new Error("Conflicting settlement transaction already recorded");
    return result;
  }

  const updated = PilotPrivateResultSchema.parse({
    ...result,
    settlement,
    knownObligation: { ...result.knownObligation, status: "SETTLED", settledTxHash: settlement.txHash },
  });
  await writePrivateJson(resolve(directory, PILOT_FILENAMES.result), updated);
  return updated;
}

interface ConsentedPilot {
  manifest: PilotManifest;
  result: PilotPrivateResult;
  feedback: PilotFeedback;
}

async function consentedPilots(pilotsRoot: string): Promise<ConsentedPilot[]> {
  if (!(await pathExists(pilotsRoot))) return [];
  const entries = await readdir(pilotsRoot, { withFileTypes: true });
  const pilots: ConsentedPilot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PILOT_ID_PATTERN.test(entry.name)) continue;
    const directory = pilotDirectory(pilotsRoot, entry.name);
    const resultPath = resolve(directory, PILOT_FILENAMES.result);
    if (!(await pathExists(resultPath))) continue;
    const [manifest, result, feedback] = await Promise.all([
      loadManifest(directory),
      readPrivateJson(resultPath).then((value) => PilotPrivateResultSchema.parse(value)),
      validatePilotFeedback(pilotsRoot, entry.name),
    ]);
    if (sha256Hex(canonicalJson(manifest)) !== result.manifestHash) throw new Error(`Manifest changed after evaluation for ${entry.name}; evaluate a fresh pilot record`);
    if (!manifest.consent.publicRedactedMetrics.granted) continue;
    pilots.push({ manifest, result, feedback });
  }
  return pilots.sort((left, right) => left.result.publicId.localeCompare(right.result.publicId));
}

function formatUsdc(amountMinor: string): string {
  const value = BigInt(amountMinor);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} USDC`;
}

function amountLabel(pilot: ConsentedPilot): string | null {
  const disclosure = pilot.manifest.publicDisclosure;
  if (disclosure.amount === "NONE") return null;
  if (disclosure.amount === "RANGE") return disclosure.amountRangeLabel;
  return formatUsdc(pilot.manifest.obligation.amountMinor);
}

function publicSettlementStatus(pilot: ConsentedPilot): "NOT_REQUESTED" | "CONSENTED_NOT_EXECUTED" | "FINAL" | "RECONCILED" {
  if (pilot.result.settlement !== null) return pilot.result.settlement.status as "FINAL" | "RECONCILED";
  return pilot.manifest.consent.settlement.granted ? "CONSENTED_NOT_EXECUTED" : "NOT_REQUESTED";
}

function publicRecord(pilot: ConsentedPilot): PublicPilotIndex["records"][number] {
  return {
    publicId: pilot.result.publicId,
    classification: "REAL",
    businessAlias: pilot.manifest.publicAliases.business,
    vendorAlias: pilot.manifest.publicAliases.vendor,
    amount: { mode: pilot.manifest.publicDisclosure.amount, label: amountLabel(pilot) },
    evidenceTypes: pilot.result.evidenceTypes,
    witnessVerdict: pilot.result.witness.verdict,
    reasonCode: pilot.result.witness.reasonCode,
    agentDecision: pilot.result.decision?.action ?? null,
    settlementStatus: publicSettlementStatus(pilot),
    evidenceRoot: pilot.manifest.publicDisclosure.evidenceRoot ? pilot.result.witness.evidenceRoot : null,
    txHash: pilot.manifest.publicDisclosure.settlementTxHash ? pilot.result.settlement?.txHash ?? null : null,
    evaluatedAt: pilot.result.evaluatedAt,
  };
}

function agreementCounts(feedback: PilotFeedback): { agreed: number; observed: number } {
  if (feedback.responseStatus !== "CAPTURED") return { agreed: 0, observed: 0 };
  const answers = [feedback.witnessAgreement, feedback.agentAgreement].filter((answer) => answer !== "NOT_ASKED");
  return { agreed: answers.filter((answer) => answer === "YES").length, observed: answers.length };
}

function isEscalation(pilot: ConsentedPilot): boolean {
  if (pilot.result.witness.verdict === "HOLD" || pilot.result.decision?.action === "ESCALATE") return true;
  if (pilot.feedback.responseStatus !== "CAPTURED") return false;
  return [pilot.feedback.witnessAgreement, pilot.feedback.agentAgreement].some((answer) => answer === "NO" || answer === "PARTIAL");
}

function assertPublicProjectionDoesNotLeak(pilots: ConsentedPilot[], serialized: string): void {
  for (const { manifest, feedback } of pilots) {
    const forbidden = [
      manifest.pilotId,
      manifest.privateBusiness.id,
      manifest.privateBusiness.legalName,
      manifest.privateVendor.id,
      manifest.privateVendor.legalName,
      manifest.obligation.id,
      manifest.obligation.invoiceNumber,
      manifest.obligation.requestedPayoutDestination,
      manifest.verifiedDestination?.address,
      manifest.consent.processEvidence.operatorReference,
      manifest.consent.publicRedactedMetrics.operatorReference,
      manifest.consent.settlement.operatorReference,
      feedback.frictionNotesPrivate || undefined,
      ...manifest.evidence.map((item) => item.relativeFile),
    ].filter((value): value is string => typeof value === "string" && value.length >= 4);
    const leaked = forbidden.find((value) => serialized.includes(value));
    if (leaked) throw new Error(`Public projection contains a forbidden private value for ${manifest.pilotId}`);
  }
}

export async function publishPilotIndex(pilotsRoot: string, outputPath: string): Promise<PublicPilotIndex> {
  const pilots = await consentedPilots(pilotsRoot);
  const agreements = pilots.map((pilot) => agreementCounts(pilot.feedback)).reduce(
    (total, item) => ({ agreed: total.agreed + item.agreed, observed: total.observed + item.observed }),
    { agreed: 0, observed: 0 },
  );
  const settlements = pilots.filter((pilot) => pilot.result.settlement !== null);
  const volumeDisclosed = settlements.every((pilot) => pilot.manifest.publicDisclosure.includeInAggregateVolume);
  const totalPaymentVolumeMinor = volumeDisclosed
    ? settlements.reduce((sum, pilot) => sum + BigInt(pilot.result.settlement!.amountMinor), 0n).toString()
    : null;
  const timestamps = pilots.flatMap((pilot) => [
    pilot.result.evaluatedAt,
    pilot.result.settlement?.finalizedAt,
    pilot.feedback.capturedAt,
  ]).filter((value): value is string => value !== null && value !== undefined).sort();
  const index = PublicPilotIndexSchema.parse({
    schemaVersion: "1",
    generatedAt: timestamps.at(-1) ?? null,
    classification: "REAL",
    metrics: {
      businessesOnboarded: new Set(pilots.map((pilot) => pilot.manifest.publicAliases.business)).size,
      obligationsProcessed: pilots.length,
      verified: pilots.filter((pilot) => pilot.result.witness.verdict === "VERIFIED").length,
      hold: pilots.filter((pilot) => pilot.result.witness.verdict === "HOLD").length,
      rejected: pilots.filter((pilot) => pilot.result.witness.verdict === "REJECT").length,
      autonomousSettlements: settlements.filter((pilot) => pilot.result.settlement?.autonomous).length,
      totalPaymentVolumeMinor,
      currency: "USDC",
      duplicatesDetected: pilots.filter((pilot) => ["DUPLICATE_OBLIGATION", "ALREADY_SETTLED"].includes(pilot.result.witness.reasonCode ?? "")).length,
      payoutChangesDetected: pilots.filter((pilot) => ["DESTINATION_CHANGED", "DESTINATION_UNVERIFIED"].includes(pilot.result.witness.reasonCode ?? "")).length,
      decisions: pilots.filter((pilot) => pilot.result.decision !== null).length,
      escalations: pilots.filter(isEscalation).length,
      humanAgreement: {
        ...agreements,
        ratePercent: agreements.observed === 0 ? null : Math.round((agreements.agreed / agreements.observed) * 10_000) / 100,
      },
    },
    records: pilots.map(publicRecord),
  });
  const serialized = JSON.stringify(index);
  assertPublicProjectionDoesNotLeak(pilots, serialized);
  await writePublicJson(outputPath, index);
  return index;
}

export function privateRelativePath(projectRoot: string, path: string): string {
  return relative(resolve(projectRoot), resolve(path));
}
