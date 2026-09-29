import { describe, expect, it } from "vitest";
import { prepareAuditEvent } from "./audit.js";

describe("append-only audit event preparation", () => {
  it("commits canonical payload content", () => {
    const base = {
      businessId: "biz_demo",
      entityType: "obligation",
      entityId: "obl_1",
      action: "WITNESS_VERDICT",
      actor: "witness:v1",
      previousState: "EVIDENCE_PENDING",
      newState: "VERIFIED",
      reasonCode: null,
      createdAt: "2026-09-29T12:00:00.000Z",
    };
    expect(prepareAuditEvent({ ...base, payload: { verdict: "VERIFIED", checks: 10 } }).payloadHash).toBe(
      prepareAuditEvent({ ...base, payload: { checks: 10, verdict: "VERIFIED" } }).payloadHash,
    );
  });
});

