import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  stringToHex,
  type Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import {
  CircleArcTransactionClient,
  circleIdempotencyKey,
  createCircleArcTransactionClient,
} from "./circle-executor.js";

export interface ArcSmokeResult {
  chainId: number;
  signer: Address;
  nonce: string;
  gas: string;
  txHash: `0x${string}`;
  circleTransactionId: string;
  blockNumber: string;
  status: "success";
}

export async function broadcastCircleArcSmoke(
  circle: CircleArcTransactionClient,
  signerAddress: Address,
  rpcUrl: string,
  usdcAddress: Address,
): Promise<ArcSmokeResult> {
  await circle.assertWalletAddress(signerAddress);
  const client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== 5_042_002) throw new Error(`Expected Arc Testnet chain ID 5042002, got ${chainId}`);
  const balance = await client.getBalance({ address: signerAddress });
  if (balance === 0n) throw new Error("Circle wallet has no native Arc USDC for smoke-test gas");

  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [signerAddress, 0n],
  });
  const gas = await client.estimateGas({
    account: signerAddress,
    to: usdcAddress,
    data: callData,
    value: 0n,
  });
  const { txHash, circleTransactionId } = await circle.submitContractExecution({
    contractAddress: usdcAddress,
    callData,
    idempotencyKey: circleIdempotencyKey(
      keccak256(stringToHex(`euthyna-arc-managed-smoke-v1:${signerAddress.toLowerCase()}`)),
    ),
    refId: "euthyna-arc-managed-smoke-v1",
    expectedAddress: signerAddress,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`Arc smoke transaction reverted: ${txHash}`);
  const transaction = await client.getTransaction({ hash: txHash });
  if (
    transaction.chainId !== chainId ||
    transaction.from.toLowerCase() !== signerAddress.toLowerCase() ||
    transaction.to?.toLowerCase() !== usdcAddress.toLowerCase() ||
    transaction.input.toLowerCase() !== callData.toLowerCase() ||
    transaction.value !== 0n
  ) {
    throw new Error("Finalized Circle smoke transaction does not match the prepared zero transfer");
  }
  return {
    chainId,
    signer: signerAddress,
    nonce: transaction.nonce.toString(),
    gas: gas.toString(),
    txHash,
    circleTransactionId,
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
  const circle = createCircleArcTransactionClient(
    {
      apiKey: required("CIRCLE_API_KEY"),
      entitySecret: required("CIRCLE_ENTITY_SECRET"),
    },
    required("CIRCLE_WALLET_ID"),
  );
  const result = await broadcastCircleArcSmoke(
    circle,
    required("CIRCLE_WALLET_ADDRESS") as Address,
    required("ARC_RPC_URL"),
    required("ARC_USDC_ADDRESS") as Address,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("arc-smoke.js")) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown smoke-test failure"}\n`);
    process.exitCode = 1;
  });
}
