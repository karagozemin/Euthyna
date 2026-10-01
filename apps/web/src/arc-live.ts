import { ARC_PROOF } from "./data";

export const ARC_RPC_URL = "https://rpc.testnet.arc.io";

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface TransactionReceipt {
  blockNumber: string;
  status: string;
  transactionHash: string;
}

export interface ArcLiveSnapshot {
  chainId: number;
  latestBlock: number;
  settlementBlock: number;
  confirmations: number;
  receiptStatus: "SUCCESS" | "REVERTED";
  vaultDeployed: boolean;
  latencyMs: number;
  verifiedAt: string;
}

async function rpc<T>(method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  const response = await fetch(ARC_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    signal,
  });

  if (!response.ok) throw new Error(`Arc RPC returned HTTP ${response.status}.`);
  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) throw new Error(`Arc RPC ${payload.error.code}: ${payload.error.message}`);
  if (payload.result === undefined || payload.result === null) throw new Error(`Arc RPC returned no result for ${method}.`);
  return payload.result;
}

function hexToNumber(value: string, label: string): number {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Arc RPC returned an invalid ${label}.`);
  return parsed;
}

export function validateArcSnapshot(input: {
  chainIdHex: string;
  latestBlockHex: string;
  receipt: TransactionReceipt;
  vaultCode: string;
  latencyMs: number;
  verifiedAt?: string;
}): ArcLiveSnapshot {
  const chainId = hexToNumber(input.chainIdHex, "chain ID");
  const latestBlock = hexToNumber(input.latestBlockHex, "latest block");
  const settlementBlock = hexToNumber(input.receipt.blockNumber, "settlement block");

  if (chainId !== ARC_PROOF.chainId) throw new Error(`Wrong network: expected Arc Testnet chain ${ARC_PROOF.chainId}.`);
  if (input.receipt.transactionHash.toLowerCase() !== ARC_PROOF.transaction.toLowerCase()) {
    throw new Error("Arc RPC returned a receipt for a different transaction.");
  }
  if (settlementBlock !== Number(ARC_PROOF.settlementBlock)) {
    throw new Error("The onchain receipt block does not match the committed public proof.");
  }
  if (input.receipt.status !== "0x1") throw new Error("The Arc settlement transaction reverted.");
  if (!input.vaultCode || input.vaultCode === "0x") throw new Error("No vault contract bytecode was found at the committed address.");

  return {
    chainId,
    latestBlock,
    settlementBlock,
    confirmations: Math.max(0, latestBlock - settlementBlock + 1),
    receiptStatus: "SUCCESS",
    vaultDeployed: true,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
  };
}

export async function fetchArcLiveSnapshot(signal?: AbortSignal): Promise<ArcLiveSnapshot> {
  const startedAt = performance.now();
  const [chainIdHex, latestBlockHex, receipt, vaultCode] = await Promise.all([
    rpc<string>("eth_chainId", [], signal),
    rpc<string>("eth_blockNumber", [], signal),
    rpc<TransactionReceipt>("eth_getTransactionReceipt", [ARC_PROOF.transaction], signal),
    rpc<string>("eth_getCode", [ARC_PROOF.vault, "latest"], signal),
  ]);

  return validateArcSnapshot({
    chainIdHex,
    latestBlockHex,
    receipt,
    vaultCode,
    latencyMs: performance.now() - startedAt,
  });
}
