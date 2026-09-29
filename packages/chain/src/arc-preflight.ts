import { loadArcDeploymentConfigFromEnv } from "./arc-config.js";
import { runArcFundingPreflight } from "./preflight.js";

async function main(): Promise<void> {
  const rawAmount = process.env.SETTLEMENT_AMOUNT_MINOR;
  if (!rawAmount || !/^[1-9][0-9]*$/.test(rawAmount)) {
    throw new Error("SETTLEMENT_AMOUNT_MINOR must be a positive integer in 6-decimal USDC base units");
  }
  const result = await runArcFundingPreflight(
    loadArcDeploymentConfigFromEnv(),
    BigInt(rawAmount),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("arc-preflight.js")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown preflight failure"}\n`);
    process.exitCode = 1;
  });
}
