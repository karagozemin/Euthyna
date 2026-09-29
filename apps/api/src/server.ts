import Fastify, { type FastifyInstance } from "fastify";
import type { EuthynaApiService } from "./service.js";

export function createApiServer(service: EuthynaApiService): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", service: "euthyna-api" }));

  app.post("/v1/businesses", async (request) => service.createBusiness(request.body));
  app.post("/v1/vendors", async (request) => service.createVendor(request.body));
  app.post<{ Params: { id: string } }>("/v1/vendors/:id/destinations", async (request) =>
    service.proposeDestination(request.params.id, request.body),
  );
  app.post<{ Params: { id: string; version: string } }>(
    "/v1/vendors/:id/destinations/:version/verify",
    async (request) =>
      service.verifyDestination(request.params.id, Number(request.params.version), request.body),
  );
  app.post("/v1/evidence", async (request) => service.ingestEvidence(request.body));
  app.post("/v1/obligations", async (request) => service.createObligation(request.body));
  app.post<{ Params: { id: string } }>("/v1/obligations/:id/verify", async (request) =>
    service.verifyObligation(request.params.id),
  );
  app.get("/v1/obligations", async (request) => service.listObligations(request.query));
  app.post("/v1/plans/run", async (request) => service.runPlan(request.body));
  app.post<{ Params: { id: string } }>("/v1/intents/:id/attest", async (request) =>
    service.attestIntent(request.params.id, request.body),
  );
  app.post<{ Params: { id: string } }>("/v1/intents/:id/simulate", async (request) =>
    service.simulateIntent(request.params.id),
  );
  app.post<{ Params: { id: string } }>("/v1/intents/:id/submit", async (request) =>
    service.submitIntent(request.params.id, request.body),
  );
  app.post("/v1/reconciliation/run", async (request) => service.reconcile(request.body));
  app.get<{ Params: { id: string } }>("/v1/receipts/:id", async (request) =>
    service.getReceipt(request.params.id),
  );
  app.get("/v1/metrics", async (request) => service.getMetrics(request.query));
  app.post<{ Params: { decisionId: string } }>("/v1/feedback/:decisionId", async (request) =>
    service.recordFeedback(request.params.decisionId, request.body),
  );

  app.setErrorHandler((error, _request, reply) => {
    const normalized = error instanceof Error ? error : new Error("Unknown API error");
    const status = /unknown|not found/i.test(normalized.message) ? 404 : 400;
    void reply.status(status).send({ error: normalized.name, message: normalized.message });
  });
  return app;
}
