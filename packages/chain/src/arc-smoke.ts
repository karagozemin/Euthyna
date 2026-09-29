import {
  createPublicClient,
  http,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type TransactionSerialized,
} from "viem";
import { arcTestnet } from "viem/chains";
import { CircleTransactionSigner, createCircleTransactionSigner } from "./circle-executor.js";

const MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

export interface ArcSmokeResult {
  chainId: number;
  signer: Address;
  nonce: string;
  gas: string;
  txHash: `0x${string}`;
  blockNumber: string;
  status: "success";
}

export async function broadcastCircleArcSmoke(
  signer: CircleTransactionSigner,
  signerAddress: Address,
  rpcUrl: string,
): Promise<ArcSmokeResult> {
  await signer.assertWalletAddress(signerAddress);
  const client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== 5_042_002) throw new Error(`Expected Arc Testnet chain ID 5042002, got ${chainId}`);
  const balance = await client.getBalance({ address: signerAddress });
  if (balance === 0n) throw new Error("Circle wallet has no native Arc USDC for smoke-test gas");

  const nonce = await client.getTransactionCount({ address: signerAddress });
  const gas = await client.estimateGas({
    account: signerAddress,
    to: signerAddress,
    value: 0n,
  });
  const fees = await client.estimateFeesPerGas();
  const maxFeePerGas =
    (fees.maxFeePerGas ?? 0n) < MIN_MAX_FEE_PER_GAS
      ? MIN_MAX_FEE_PER_GAS
      : (fees.maxFeePerGas ?? MIN_MAX_FEE_PER_GAS);
  const maxPriorityFeePerGas =
    (fees.maxPriorityFeePerGas ?? 0n) > maxFeePerGas
      ? maxFeePerGas
      : (fees.maxPriorityFeePerGas ?? 0n);

  const serialized = await signer.sign(
    {
      chainId,
      nonce: nonce.toString(),
      to: signerAddress,
      value: "0",
      gas: gas.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    },
    "Euthyna Arc Testnet signing smoke test: zero-value self transaction",
  );
  const serializedTransaction = serialized as TransactionSerialized;
  const decoded = parseTransaction(serializedTransaction);
  if (decoded.chainId !== chainId || decoded.to?.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error("Circle returned a signed transaction for the wrong chain or recipient");
  }
  if ((decoded.value ?? 0n) !== 0n) throw new Error("Smoke transaction must have zero value");
  const recoveredSigner = await recoverTransactionAddress({ serializedTransaction });
  if (recoveredSigner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error("Circle returned a transaction signed by an unexpected address");
  }

  const txHash = await client.sendRawTransaction({ serializedTransaction });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`Arc smoke transaction reverted: ${txHash}`);
  return {
    chainId,
    signer: signerAddress,
    nonce: nonce.toString(),
    gas: gas.toString(),
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    status: "success",
  };
}

async function main(): Promise<void> {
  if (process.env.ARC_SMOKE_BROADCAST !== "YES") {
    throw new Error("Set ARC_SMOKE_BROADCAST=YES to acknowledge the zero-value on-chain smoke transaction");
  }
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const signer = createCircleTransactionSigner(
    {
      apiKey: required("CIRCLE_API_KEY"),
      entitySecret: required("CIRCLE_ENTITY_SECRET"),
    },
    required("CIRCLE_WALLET_ID"),
  );
  const result = await broadcastCircleArcSmoke(
    signer,
    required("CIRCLE_WALLET_ADDRESS") as Address,
    required("ARC_RPC_URL"),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("arc-smoke.js")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown smoke-test failure"}\n`);
    process.exitCode = 1;
  });
}
