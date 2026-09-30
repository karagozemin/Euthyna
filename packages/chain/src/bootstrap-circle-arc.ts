import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";
import { getAddress } from "viem";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(projectRoot, ".env.arc-testnet.local");
const privateDir = resolve(projectRoot, ".euthyna/circle");
const recoveryDir = resolve(privateDir, "recovery");
const statePath = resolve(privateDir, "bootstrap-state.json");
const walletSetName = "Euthyna Arc Testnet";

interface BootstrapState {
  walletSetIdempotencyKey: string;
  walletIdempotencyKey: string;
  walletSetId?: string;
}

function parseEnv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (values.has(key)) throw new Error(`Duplicate environment assignment: ${key}`);
    values.set(key, value);
  }
  return values;
}

async function updateEnv(updates: Readonly<Record<string, string>>): Promise<void> {
  const current = await readFile(envPath, "utf8");
  const remaining = new Set(Object.keys(updates));
  const next = current
    .split(/\r?\n/u)
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator < 1) return line;
      const key = line.slice(0, separator).trim();
      if (!remaining.has(key)) return line;
      remaining.delete(key);
      return `${key}=${updates[key]}`;
    });
  if (remaining.size > 0) {
    throw new Error(`Missing environment slots: ${[...remaining].join(", ")}`);
  }
  const temporaryPath = `${envPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, next.join("\n"), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, envPath);
  await chmod(envPath, 0o600);
}

async function loadState(): Promise<BootstrapState> {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<BootstrapState>;
    if (!parsed.walletSetIdempotencyKey || !parsed.walletIdempotencyKey) {
      throw new Error("Circle bootstrap state is incomplete");
    }
    return parsed as BootstrapState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const created: BootstrapState = {
      walletSetIdempotencyKey: randomUUID(),
      walletIdempotencyKey: randomUUID(),
    };
    await writeFile(statePath, `${JSON.stringify(created, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return created;
  }
}

async function saveState(state: BootstrapState): Promise<void> {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
}

function circleError(error: unknown): { code?: number; status?: number } {
  if (!error || typeof error !== "object") return {};
  const value = error as { code?: unknown; status?: unknown };
  const result: { code?: number; status?: number } = {};
  if (typeof value.code === "number") result.code = value.code;
  if (typeof value.status === "number") result.status = value.status;
  return result;
}

async function assertApiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.circle.com/v1/w3s/config/entity/publicKey", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Circle API-key validation failed with HTTP ${response.status}`);
  }
}

async function main(): Promise<void> {
  const envStats = await stat(envPath);
  if ((envStats.mode & 0o077) !== 0) {
    throw new Error(".env.arc-testnet.local must not be accessible by group or others");
  }

  let envContents = await readFile(envPath, "utf8");
  let env = parseEnv(envContents);
  const apiKey = env.get("CIRCLE_API_KEY") ?? "";
  if (!apiKey) throw new Error("CIRCLE_API_KEY is missing");

  await assertApiKey(apiKey);
  console.log("Circle API key authenticated.");

  let entitySecret = env.get("CIRCLE_ENTITY_SECRET") ?? "";
  if (!entitySecret) {
    entitySecret = randomBytes(32).toString("hex");
    await updateEnv({ CIRCLE_ENTITY_SECRET: entitySecret });
    console.log("A new entity secret was stored locally.");
  }
  if (!/^[0-9a-fA-F]{64}$/u.test(entitySecret)) {
    throw new Error("CIRCLE_ENTITY_SECRET must be exactly 32 bytes encoded as hex");
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  const configuredWalletId = env.get("CIRCLE_WALLET_ID") ?? "";
  const configuredWalletAddress = env.get("CIRCLE_WALLET_ADDRESS") ?? "";
  if (Boolean(configuredWalletId) !== Boolean(configuredWalletAddress)) {
    throw new Error("CIRCLE_WALLET_ID and CIRCLE_WALLET_ADDRESS must be set together");
  }
  if (configuredWalletId && configuredWalletAddress) {
    const response = await client.getWallet({ id: configuredWalletId });
    const wallet = response.data?.wallet;
    if (
      !wallet ||
      wallet.blockchain !== "ARC-TESTNET" ||
      wallet.accountType !== "EOA" ||
      getAddress(wallet.address) !== getAddress(configuredWalletAddress)
    ) {
      throw new Error("Configured Circle wallet identity does not match an Arc Testnet EOA");
    }
    console.log("Existing Arc Testnet EOA wallet verified.");
    return;
  }

  const state = await loadState();
  let walletSetId = state.walletSetId;
  if (walletSetId) {
    await client.getWalletSet({ id: walletSetId });
  } else {
    const createWalletSet = () =>
      client.createWalletSet({
        name: walletSetName,
        idempotencyKey: state.walletSetIdempotencyKey,
      });
    let response;
    try {
      response = await createWalletSet();
      console.log("Existing entity-secret registration verified.");
    } catch (error) {
      const { code } = circleError(error);
      if (code !== 156016 && code !== 177605) throw error;
      await mkdir(recoveryDir, { recursive: true, mode: 0o700 });
      await chmod(recoveryDir, 0o700);
      await registerEntitySecretCiphertext({
        apiKey,
        entitySecret,
        recoveryFileDownloadPath: recoveryDir,
      });
      console.log("Entity secret registered and recovery file stored locally.");
      response = await createWalletSet();
    }
    walletSetId = response.data?.walletSet?.id;
    if (!walletSetId) throw new Error("Circle did not return a wallet-set ID");
    await saveState({ ...state, walletSetId });
  }

  const response = await client.createWallets({
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    idempotencyKey: state.walletIdempotencyKey,
    metadata: [
      {
        name: "Euthyna Arc Testnet Settlement",
        refId: "euthyna-arc-testnet-settlement",
      },
    ],
  });
  const wallets = response.data?.wallets ?? [];
  if (wallets.length !== 1) throw new Error("Circle did not return exactly one wallet");
  const wallet = wallets[0];
  if (!wallet || wallet.blockchain !== "ARC-TESTNET" || wallet.accountType !== "EOA") {
    throw new Error("Circle returned a wallet with the wrong chain or account type");
  }
  const walletAddress = getAddress(wallet.address);
  await updateEnv({
    CIRCLE_WALLET_ID: wallet.id,
    CIRCLE_WALLET_ADDRESS: walletAddress,
  });

  envContents = await readFile(envPath, "utf8");
  env = parseEnv(envContents);
  const verification = await client.getWallet({ id: env.get("CIRCLE_WALLET_ID") ?? "" });
  if (getAddress(verification.data?.wallet?.address ?? "") !== walletAddress) {
    throw new Error("Circle wallet verification failed after local persistence");
  }
  console.log("Arc Testnet EOA wallet created and verified.");
}

main().catch((error: unknown) => {
  const { code, status } = circleError(error);
  const safeDetails = [
    code === undefined ? undefined : `code=${code}`,
    status === undefined ? undefined : `status=${status}`,
  ].filter(Boolean);
  const knownMessage = error instanceof Error && !code && !status ? error.message : "Circle request failed";
  console.error(`Circle bootstrap failed: ${knownMessage}${safeDetails.length ? ` (${safeDetails.join(", ")})` : ""}`);
  process.exitCode = 1;
});
