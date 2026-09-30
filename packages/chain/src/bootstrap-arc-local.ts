import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(projectRoot, ".env.arc-testnet.local");
const privateDir = resolve(projectRoot, ".euthyna/keys");
const payeeKeyPath = resolve(privateDir, "test-vendor-payee.private-key");
const defaultBusinessId = "euthyna-tameion-test-001";
const defaultVendorId = "vendor_arc_test";

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

function asPrivateKey(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key`);
  }
  return value as Hex;
}

function resolveKeyPair(
  privateKeyValue: string,
  addressValue: string,
  privateKeyName: string,
  addressName: string,
): { privateKey: Hex; address: Address } {
  if (!privateKeyValue && addressValue) {
    throw new Error(`${privateKeyName} is required to prove ${addressName}`);
  }
  const privateKey = privateKeyValue
    ? asPrivateKey(privateKeyValue, privateKeyName)
    : generatePrivateKey();
  const derivedAddress = privateKeyToAccount(privateKey).address;
  if (addressValue && getAddress(addressValue) !== derivedAddress) {
    throw new Error(`${privateKeyName} does not derive to ${addressName}`);
  }
  return { privateKey, address: derivedAddress };
}

async function resolvePayeeAddress(configuredAddress: string): Promise<Address> {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  let privateKey: Hex | undefined;
  try {
    privateKey = asPrivateKey((await readFile(payeeKeyPath, "utf8")).trim(), "payee key file");
    await chmod(payeeKeyPath, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!privateKey && configuredAddress) return getAddress(configuredAddress);
  if (!privateKey) {
    privateKey = generatePrivateKey();
    await writeFile(payeeKeyPath, `${privateKey}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }
  const address = privateKeyToAccount(privateKey).address;
  if (configuredAddress && getAddress(configuredAddress) !== address) {
    throw new Error("Stored test vendor payee key does not match TEST_VENDOR_PAYEE_ADDRESS");
  }
  return address;
}

async function main(): Promise<void> {
  const envStats = await stat(envPath);
  if ((envStats.mode & 0o077) !== 0) {
    throw new Error(".env.arc-testnet.local must not be accessible by group or others");
  }
  const env = parseEnv(await readFile(envPath, "utf8"));
  const deployer = resolveKeyPair(
    env.get("ARC_DEPLOYER_PRIVATE_KEY") ?? "",
    env.get("VAULT_OWNER_ADDRESS") ?? "",
    "ARC_DEPLOYER_PRIVATE_KEY",
    "VAULT_OWNER_ADDRESS",
  );
  const witness = resolveKeyPair(
    env.get("WITNESS_SIGNER_PRIVATE_KEY") ?? "",
    env.get("WITNESS_SIGNER_ADDRESS") ?? "",
    "WITNESS_SIGNER_PRIVATE_KEY",
    "WITNESS_SIGNER_ADDRESS",
  );
  const payee = await resolvePayeeAddress(env.get("TEST_VENDOR_PAYEE_ADDRESS") ?? "");
  const circleAddressValue = env.get("CIRCLE_WALLET_ADDRESS") ?? "";
  if (!circleAddressValue) throw new Error("CIRCLE_WALLET_ADDRESS must be configured first");
  const identities = new Set(
    [deployer.address, witness.address, payee, getAddress(circleAddressValue)].map((value) =>
      value.toLowerCase(),
    ),
  );
  if (identities.size !== 4) {
    throw new Error("Deployer, witness, payee, and Circle wallet must be four distinct addresses");
  }

  const businessId = env.get("VAULT_BUSINESS_ID") || defaultBusinessId;
  const businessIdHash = keccak256(stringToHex(businessId));
  const configuredBusinessHash = env.get("VAULT_BUSINESS_ID_HASH") ?? "";
  if (configuredBusinessHash && configuredBusinessHash.toLowerCase() !== businessIdHash) {
    throw new Error("VAULT_BUSINESS_ID_HASH does not match VAULT_BUSINESS_ID");
  }
  const vendorId = env.get("TEST_VENDOR_ID") || defaultVendorId;
  const vendorIdHash = keccak256(stringToHex(vendorId));
  const configuredVendorHash = env.get("TEST_VENDOR_ID_HASH") ?? "";
  if (configuredVendorHash && configuredVendorHash.toLowerCase() !== vendorIdHash) {
    throw new Error("TEST_VENDOR_ID_HASH does not match TEST_VENDOR_ID");
  }

  const signerVersion = env.get("WITNESS_SIGNER_KEY_VERSION") || "1";
  if (!/^[1-9][0-9]*$/u.test(signerVersion)) {
    throw new Error("WITNESS_SIGNER_KEY_VERSION must be a positive integer");
  }
  const createdAt = env.get("TEST_RUN_CREATED_AT") || new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("TEST_RUN_CREATED_AT is not ISO-8601");
  const nowUnix = Math.floor(Date.now() / 1_000);
  const validUntilUnix = env.get("TEST_VALID_UNTIL_UNIX") || String(nowUnix + 7 * 86_400);
  if (!/^[1-9][0-9]*$/u.test(validUntilUnix) || BigInt(validUntilUnix) <= BigInt(nowUnix)) {
    throw new Error("TEST_VALID_UNTIL_UNIX must be a future Unix timestamp");
  }

  await updateEnv({
    VAULT_BUSINESS_ID: businessId,
    VAULT_BUSINESS_ID_HASH: businessIdHash,
    VAULT_OWNER_ADDRESS: deployer.address,
    WITNESS_SIGNER_KEY_VERSION: signerVersion,
    WITNESS_SIGNER_ADDRESS: witness.address,
    ARC_DEPLOYER_PRIVATE_KEY: deployer.privateKey,
    WITNESS_SIGNER_PRIVATE_KEY: witness.privateKey,
    TEST_VENDOR_ID: vendorId,
    TEST_VENDOR_ID_HASH: vendorIdHash,
    TEST_VENDOR_PAYEE_ADDRESS: payee,
    TEST_RUN_CREATED_AT: createdAt,
    TEST_VALID_UNTIL_UNIX: validUntilUnix,
  });
  console.log("Local Arc identities, hashes, and fixed fixture timestamps are configured and verified.");
}

main().catch((error: unknown) => {
  console.error(`Local Arc bootstrap failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
