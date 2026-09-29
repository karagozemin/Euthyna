import { createHash } from "node:crypto";
import type {
  EvidenceArtifact,
  LineItem,
  Obligation,
  WitnessCheck,
} from "@euthyna/domain";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function sortValue(value: unknown): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  throw new Error(`unsupported canonical JSON value: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(value: string): `0x${string}` {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

export function obligationFingerprint(
  obligation: Pick<
    Obligation,
    "businessId" | "vendorId" | "invoiceNumber" | "invoiceDate" | "amountMinor" | "currency"
  >,
): `0x${string}` {
  return sha256Hex(
    canonicalJson({
      businessId: obligation.businessId,
      vendorId: obligation.vendorId,
      invoiceNumber: normalizeIdentifier(obligation.invoiceNumber),
      invoiceDate: obligation.invoiceDate,
      amountMinor: obligation.amountMinor,
      currency: obligation.currency,
    }),
  );
}

export function lineItemFingerprint(items: readonly LineItem[]): `0x${string}` {
  const normalized = items
    .map((item) => ({
      description: normalizeIdentifier(item.description),
      amountMinor: item.amountMinor,
      quantityMinor: item.quantityMinor,
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return sha256Hex(canonicalJson(normalized));
}

export function evidenceRoot(
  artifacts: readonly EvidenceArtifact[],
  checks: readonly WitnessCheck[],
): `0x${string}` {
  const artifactCommitments = artifacts
    .map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      contentHash: artifact.contentHash.toLowerCase(),
      normalizedContentHash: artifact.normalizedContentHash.toLowerCase(),
      rawArtifactHash: artifact.rawArtifactHash.toLowerCase(),
      sourceChannel: artifact.source.channel,
      issuer: artifact.issuer,
      receivedAt: artifact.receivedAt,
      relevantIdentifiers: artifact.relevantIdentifiers,
      relationships: artifact.relationships,
      provenanceMetadata: artifact.provenanceMetadata,
      parser: artifact.parser,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const checkCommitments = checks
    .map((check) => ({
      id: check.id,
      status: check.status,
      disposition: check.disposition,
      reasonCode: check.reasonCode,
      expected: check.expected,
      observed: check.observed,
      relatedArtifactIds: [...check.relatedArtifactIds].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256Hex(canonicalJson({ artifactCommitments, checkCommitments }));
}
