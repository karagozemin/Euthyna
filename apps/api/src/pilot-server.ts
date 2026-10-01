import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { intakeAndEvaluatePilot, recordPilotFeedback } from "./pilot.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultPilotsRoot = resolve(projectRoot, ".euthyna", "pilots");

export function createPilotOperatorServer(pilotsRoot = defaultPilotsRoot): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 110 * 1024 * 1024 });

  app.addHook("onSend", async (_request, reply, payload) => {
    void reply.header("Cache-Control", "no-store");
    void reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "euthyna-private-pilot",
    classification: "REAL",
    capabilities: { privateIntake: true, witness: true, agent: true, settlementBroadcast: false },
  }));

  app.post("/v1/pilots/intake-and-evaluate", async (request) => intakeAndEvaluatePilot(pilotsRoot, request.body));
  app.post<{ Params: { id: string } }>("/v1/pilots/:id/feedback", async (request) => {
    const feedback = await recordPilotFeedback(pilotsRoot, request.params.id, request.body);
    return { saved: true, classification: feedback.classification, capturedAt: feedback.capturedAt };
  });

  app.setErrorHandler((error, _request, reply) => {
    const normalized = error instanceof Error ? error : new Error("Private pilot request failed");
    void reply.status(400).send({ error: normalized.name, message: normalized.message });
  });
  return app;
}

async function main(): Promise<void> {
  const app = createPilotOperatorServer();
  await app.listen({ host: "127.0.0.1", port: 8787 });
  process.stdout.write("Euthyna private pilot API listening on http://127.0.0.1:8787\n");
  process.stdout.write("Private files remain under .euthyna/pilots and are never served.\n");
}

if (process.argv[1]?.endsWith("pilot-server.js")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Pilot server failed"}\n`);
    process.exitCode = 1;
  });
}
