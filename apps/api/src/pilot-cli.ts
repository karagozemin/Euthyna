import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePilot,
  initializePilot,
  pilotDirectory,
  privateRelativePath,
  publishPilotIndex,
  recordPilotSettlement,
  validatePilotFeedback,
} from "./pilot.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const pilotsRoot = resolve(projectRoot, ".euthyna", "pilots");
const publicIndexPath = resolve(projectRoot, "artifacts", "pilots", "public-index.json");

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return value;
}

function safeOutput(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || ["help", "--help", "-h"].includes(command)) {
    safeOutput({
      commands: [
        "init --pilot-id pilot_<private-id>",
        "evaluate --pilot-id pilot_<private-id>",
        "feedback --pilot-id pilot_<private-id>",
        "record-settlement --pilot-id pilot_<private-id>",
        "publish",
      ],
      privateRoot: ".euthyna/pilots (gitignored)",
      runbook: "docs/REAL_PILOT_RUNBOOK.md",
    });
    return;
  }

  if (command === "init") {
    const pilotId = option("--pilot-id");
    const directory = await initializePilot(pilotsRoot, pilotId);
    safeOutput({ initialized: true, classification: "REAL", privateDirectory: privateRelativePath(projectRoot, directory) });
    return;
  }
  if (command === "evaluate") {
    const pilotId = option("--pilot-id");
    const result = await evaluatePilot(pilotsRoot, pilotId);
    safeOutput({
      evaluated: true,
      classification: result.classification,
      pilotId: result.pilotId,
      witnessVerdict: result.witness.verdict,
      reasonCode: result.witness.reasonCode,
      agentDecision: result.decision?.action ?? null,
      settlementEligible: result.settlementEligible,
      privateResult: privateRelativePath(projectRoot, resolve(pilotDirectory(pilotsRoot, pilotId), "result.private.json")),
    });
    return;
  }
  if (command === "feedback") {
    const pilotId = option("--pilot-id");
    const feedback = await validatePilotFeedback(pilotsRoot, pilotId);
    safeOutput({ validated: true, classification: feedback.classification, pilotId, responseStatus: feedback.responseStatus });
    return;
  }
  if (command === "record-settlement") {
    const pilotId = option("--pilot-id");
    const result = await recordPilotSettlement(pilotsRoot, pilotId);
    safeOutput({ recorded: true, classification: result.classification, pilotId, settlementStatus: result.settlement?.status, txHash: result.settlement?.txHash });
    return;
  }
  if (command === "publish") {
    const index = await publishPilotIndex(pilotsRoot, publicIndexPath);
    safeOutput({ published: true, classification: "REAL", obligationsProcessed: index.metrics.obligationsProcessed, records: index.records.length, output: privateRelativePath(projectRoot, publicIndexPath) });
    return;
  }
  throw new Error(`Unknown pilot command: ${command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Pilot workflow failed"}\n`);
  process.exitCode = 1;
});
