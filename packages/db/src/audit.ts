import { canonicalJson, sha256Hex } from "@euthyna/evidence";

export interface AuditEventInput {
  businessId: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  previousState: string | null;
  newState: string | null;
  reasonCode: string | null;
  payload: unknown;
  createdAt: string;
}

export interface PreparedAuditEvent extends Omit<AuditEventInput, "payload"> {
  payloadJson: unknown;
  payloadHash: `0x${string}`;
}

export function prepareAuditEvent(input: AuditEventInput): PreparedAuditEvent {
  return {
    businessId: input.businessId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actor: input.actor,
    previousState: input.previousState,
    newState: input.newState,
    reasonCode: input.reasonCode,
    payloadJson: input.payload,
    payloadHash: sha256Hex(canonicalJson(input.payload)),
    createdAt: input.createdAt,
  };
}

