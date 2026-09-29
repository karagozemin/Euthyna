import { describe, expect, it, vi } from "vitest";
import { createApiServer } from "./server.js";
import type { EuthynaApiService } from "./service.js";

function mockService(): EuthynaApiService {
  const response = async () => ({ ok: true });
  return {
    createBusiness: vi.fn(response), createVendor: vi.fn(response), proposeDestination: vi.fn(response),
    verifyDestination: vi.fn(response), ingestEvidence: vi.fn(response), createObligation: vi.fn(response),
    verifyObligation: vi.fn(response), listObligations: vi.fn(response), runPlan: vi.fn(response),
    attestIntent: vi.fn(response), simulateIntent: vi.fn(response), submitIntent: vi.fn(response),
    reconcile: vi.fn(response), getReceipt: vi.fn(response), getMetrics: vi.fn(response),
    recordFeedback: vi.fn(response),
  };
}

describe("PRD API surface", () => {
  it("routes verification, authorization, execution, reconciliation, and receipts through the service boundary", async () => {
    const service = mockService();
    const app = createApiServer(service);
    const calls = [
      ["POST", "/v1/obligations/obl_1/verify"],
      ["POST", "/v1/plans/run"],
      ["POST", "/v1/intents/intent_1/attest"],
      ["POST", "/v1/intents/intent_1/simulate"],
      ["POST", "/v1/intents/intent_1/submit"],
      ["POST", "/v1/reconciliation/run"],
      ["GET", "/v1/receipts/rcpt_1"],
    ] as const;
    for (const [method, url] of calls) {
      const response = method === "POST"
        ? await app.inject({ method: "POST", url, payload: {} })
        : await app.inject({ method: "GET", url });
      expect(response.statusCode, `${method} ${url}`).toBe(200);
    }
    expect(service.verifyObligation).toHaveBeenCalledWith("obl_1");
    expect(service.getReceipt).toHaveBeenCalledWith("rcpt_1");
    await app.close();
  });
});
