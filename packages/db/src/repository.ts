import { randomUUID } from "node:crypto";
import type {
  DecisionReceipt,
  EvidenceArtifact,
  Obligation,
  PaymentPlan,
  Settlement,
  Vendor,
  VendorDestination,
  WitnessResult,
} from "@euthyna/domain";
import type { PreparedAuditEvent } from "./audit.js";
import { prepareAuditEvent } from "./audit.js";

export interface StoredObligation {
  obligation: Obligation;
  evidenceIds: string[];
}

export interface StoredAuthorization {
  id: string;
  operationId: string;
  obligationId: string;
  attestationHash: string;
  payload: unknown;
  createdAt: string;
}

export interface RepositoryState {
  vendors: Map<string, Vendor>;
  destinations: Map<string, VendorDestination[]>;
  artifacts: Map<string, EvidenceArtifact>;
  obligations: Map<string, StoredObligation>;
  witnessRuns: Map<string, WitnessResult[]>;
  plans: Map<string, PaymentPlan>;
  authorizations: Map<string, StoredAuthorization>;
  settlements: Map<string, Settlement>;
  receipts: Map<string, DecisionReceipt>;
  auditEvents: Array<PreparedAuditEvent & { id: string }>;
}

const transitions: Record<Obligation["status"], Obligation["status"][]> = {
  INGESTED: ["NORMALIZED", "REJECTED"],
  NORMALIZED: ["EVIDENCE_PENDING", "REJECTED"],
  EVIDENCE_PENDING: ["VERIFIED", "HOLD", "REJECTED"],
  VERIFIED: ["PLANNED", "HOLD"],
  HOLD: ["VERIFIED", "REJECTED"],
  REJECTED: [],
  PLANNED: ["AUTHORIZED", "HOLD"],
  AUTHORIZED: ["SUBMITTED", "HOLD"],
  SUBMITTED: ["SETTLED", "HOLD"],
  SETTLED: [],
};

export class RepositoryTransaction {
  constructor(private readonly state: RepositoryState) {}

  createVendor(vendor: Vendor, actor: string, at: string): void {
    if (this.state.vendors.has(vendor.id)) throw new Error(`Vendor ${vendor.id} already exists`);
    if (vendor.currentVersion !== 0 || vendor.status !== "PENDING_ONBOARDING") {
      throw new Error("A new vendor identity must begin in PENDING_ONBOARDING without a destination version");
    }
    this.state.vendors.set(vendor.id, structuredClone(vendor));
    this.audit(vendor.businessId, "vendor", vendor.id, "VENDOR_CREATED", actor, null, vendor.status, null, vendor, at);
  }

  proposeDestination(vendorId: string, address: string, chain: string, actor: string, at: string): VendorDestination {
    const vendor = this.requireVendor(vendorId);
    const history = this.state.destinations.get(vendorId) ?? [];
    const verified = history.find((item) => item.status === "VERIFIED");
    if (verified?.address.toLowerCase() === address.toLowerCase()) return structuredClone(verified);
    const destination: VendorDestination = {
      vendorId,
      version: Math.max(0, ...history.map((item) => item.version)) + 1,
      chain,
      address,
      status: "PROPOSED",
      changeKind: verified ? "DESTINATION_CHANGE" : "INITIAL_ONBOARDING",
      verificationMethod: null,
      approvedBy: null,
      approvedAt: null,
      firstSeenAt: at,
    };
    history.push(destination);
    this.state.destinations.set(vendorId, history);
    vendor.status = verified ? "PENDING_CHANGE" : "PENDING_ONBOARDING";
    this.audit(vendor.businessId, "vendor_destination", `${vendorId}:${destination.version}`, "DESTINATION_PROPOSED", actor, null, destination.status, verified ? "DESTINATION_CHANGED" : "DESTINATION_UNVERIFIED", destination, at);
    return structuredClone(destination);
  }

  verifyDestination(vendorId: string, version: number, method: string, owner: string, at: string): VendorDestination {
    const vendor = this.requireVendor(vendorId);
    const history = this.state.destinations.get(vendorId) ?? [];
    const destination = history.find((item) => item.version === version);
    if (!destination || destination.status !== "PROPOSED") throw new Error("Proposed destination version not found");
    for (const item of history) if (item.status === "VERIFIED") item.status = "SUPERSEDED";
    destination.status = "VERIFIED";
    destination.verificationMethod = method;
    destination.approvedBy = owner;
    destination.approvedAt = at;
    vendor.currentVersion = version;
    vendor.status = "ACTIVE";
    this.audit(vendor.businessId, "vendor_destination", `${vendorId}:${version}`, "DESTINATION_VERIFIED", owner, "PROPOSED", "VERIFIED", null, destination, at);
    return structuredClone(destination);
  }

  currentDestination(vendorId: string): VendorDestination | null {
    return structuredClone((this.state.destinations.get(vendorId) ?? []).find((item) => item.status === "VERIFIED") ?? null);
  }

  destinationHistory(vendorId: string): VendorDestination[] {
    return structuredClone(this.state.destinations.get(vendorId) ?? []);
  }

  putArtifact(artifact: EvidenceArtifact, actor: string): void {
    if (this.state.artifacts.has(artifact.id)) throw new Error(`Artifact ${artifact.id} already exists`);
    this.state.artifacts.set(artifact.id, structuredClone(artifact));
    this.audit(artifact.businessId, "evidence_artifact", artifact.id, "EVIDENCE_INGESTED", actor, null, "IMMUTABLE", null, { normalizedContentHash: artifact.normalizedContentHash, rawArtifactHash: artifact.rawArtifactHash }, artifact.ingestedAt);
  }

  createObligation(obligation: Obligation, evidenceIds: string[], actor: string, at: string): void {
    if (this.state.obligations.has(obligation.id)) throw new Error(`Obligation ${obligation.id} already exists`);
    for (const id of evidenceIds) if (!this.state.artifacts.has(id)) throw new Error(`Unknown evidence ${id}`);
    this.state.obligations.set(obligation.id, { obligation: structuredClone(obligation), evidenceIds: [...new Set(evidenceIds)] });
    this.audit(obligation.businessId, "obligation", obligation.id, "OBLIGATION_CREATED", actor, null, obligation.status, null, { evidenceIds }, at);
  }

  transitionObligation(id: string, next: Obligation["status"], actor: string, reason: string | null, at: string): void {
    const stored = this.requireObligation(id);
    const previous = stored.obligation.status;
    if (!transitions[previous].includes(next)) throw new Error(`Invalid obligation transition ${previous} -> ${next}`);
    stored.obligation.status = next;
    this.audit(stored.obligation.businessId, "obligation", id, "STATE_TRANSITION", actor, previous, next, reason, {}, at);
  }

  saveWitnessResult(result: WitnessResult, actor: string): void {
    this.requireObligation(result.obligationId);
    const history = this.state.witnessRuns.get(result.obligationId) ?? [];
    history.push(structuredClone(result));
    this.state.witnessRuns.set(result.obligationId, history);
    const next = result.verdict === "VERIFIED" ? "VERIFIED" : result.verdict === "HOLD" ? "HOLD" : "REJECTED";
    this.transitionObligation(result.obligationId, next, actor, result.reasonCode, result.evaluatedAt);
  }

  savePlan(plan: PaymentPlan): void {
    if (this.state.plans.has(plan.planId)) throw new Error(`Plan ${plan.planId} already exists`);
    this.state.plans.set(plan.planId, structuredClone(plan));
  }

  saveAuthorization(record: StoredAuthorization): void {
    if (this.state.authorizations.has(record.operationId)) throw new Error(`Operation ${record.operationId} already authorized`);
    this.state.authorizations.set(record.operationId, structuredClone(record));
  }

  saveSettlement(obligationId: string, settlement: Settlement, actor: string): void {
    const stored = this.requireObligation(obligationId);
    const existing = this.state.settlements.get(obligationId);
    if (existing && existing.txHash.toLowerCase() !== settlement.txHash.toLowerCase()) throw new Error("Conflicting settlement transaction");
    this.state.settlements.set(obligationId, structuredClone(settlement));
    if (stored.obligation.status === "AUTHORIZED") this.transitionObligation(obligationId, "SUBMITTED", actor, null, settlement.finalizedAt);
    if (stored.obligation.status === "SUBMITTED") this.transitionObligation(obligationId, "SETTLED", actor, null, settlement.finalizedAt);
    stored.obligation.settledTxHash = settlement.txHash;
  }

  markSubmitted(obligationId: string, actor: string, at: string): void {
    this.transitionObligation(obligationId, "SUBMITTED", actor, null, at);
  }

  markExecutionFailed(obligationId: string, actor: string, reason: string, at: string): void {
    const stored = this.requireObligation(obligationId);
    if (stored.obligation.status !== "SUBMITTED") throw new Error("Only a submitted obligation can record execution failure");
    this.transitionObligation(obligationId, "HOLD", actor, reason, at);
  }

  saveReceipt(receipt: DecisionReceipt): void {
    const existing = this.state.receipts.get(receipt.receiptId);
    if (existing && existing.receiptHash !== receipt.receiptHash) throw new Error("Decision receipt is immutable");
    this.state.receipts.set(receipt.receiptId, structuredClone(receipt));
  }

  getVendor(id: string): Vendor { return structuredClone(this.requireVendor(id)); }
  getObligation(id: string): StoredObligation { return structuredClone(this.requireObligation(id)); }
  getArtifacts(ids: string[]): EvidenceArtifact[] {
    return ids.map((id) => {
      const artifact = this.state.artifacts.get(id);
      if (!artifact) throw new Error(`Unknown evidence ${id}`);
      return structuredClone(artifact);
    });
  }
  listObligations(): StoredObligation[] { return structuredClone([...this.state.obligations.values()]); }
  getWitness(id: string): WitnessResult | null { return structuredClone(this.state.witnessRuns.get(id)?.at(-1) ?? null); }
  getSettlement(id: string): Settlement | null { return structuredClone(this.state.settlements.get(id) ?? null); }
  getReceipt(id: string): DecisionReceipt | null { return structuredClone(this.state.receipts.get(id) ?? null); }

  private requireVendor(id: string): Vendor {
    const vendor = this.state.vendors.get(id);
    if (!vendor) throw new Error(`Unknown vendor ${id}`);
    return vendor;
  }

  private requireObligation(id: string): StoredObligation {
    const stored = this.state.obligations.get(id);
    if (!stored) throw new Error(`Unknown obligation ${id}`);
    return stored;
  }

  private audit(businessId: string, entityType: string, entityId: string, action: string, actor: string, previousState: string | null, newState: string | null, reasonCode: string | null, payload: unknown, at: string): void {
    this.state.auditEvents.push({ id: randomUUID(), ...prepareAuditEvent({ businessId, entityType, entityId, action, actor, previousState, newState, reasonCode, payload, createdAt: at }) });
  }
}

export class InMemoryEuthynaRepository {
  private state: RepositoryState = {
    vendors: new Map(), destinations: new Map(), artifacts: new Map(), obligations: new Map(),
    witnessRuns: new Map(), plans: new Map(), authorizations: new Map(), settlements: new Map(), receipts: new Map(), auditEvents: [],
  };
  private queue: Promise<void> = Promise.resolve();

  transaction<T>(work: (transaction: RepositoryTransaction) => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const value = await work(new RepositoryTransaction(draft));
      this.state = draft;
      return value;
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  snapshot(): RepositoryState { return structuredClone(this.state); }
}
