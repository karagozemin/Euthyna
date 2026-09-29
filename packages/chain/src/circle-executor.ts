import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  SettlementSchema,
  WitnessAttestationSchema,
  type Settlement,
  type WitnessAttestation,
} from "@euthyna/domain";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { arc, arcTestnet } from "viem/chains";
import {
  ArcDeploymentConfigSchema,
  arcExplorerTransactionUrl,
  type ArcDeploymentConfig,
} from "./arc-config.js";
import { encodeReleaseCall, OBLIGATION_VAULT_ABI } from "./attestation.js";
import type { ExecutionSimulator, PreparedTransaction } from "./simulator.js";

const ARC_MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

export interface CircleSigningClient {
  signTransaction(input: {
    walletId: string;
    transaction: string;
    memo?: string;
  }): Promise<{ data?: { signedTransaction?: string; txHash?: string } }>;
}

export interface CircleSignerCredentials {
  apiKey: string;
  entitySecret: string;
}

export class CircleTransactionSigner {
  constructor(
    private readonly client: CircleSigningClient,
    private readonly walletId: string,
  ) {}

  async sign(transaction: Record<string, string | number>, memo: string): Promise<Hex> {
    const response = await this.client.signTransaction({
      walletId: this.walletId,
      transaction: JSON.stringify(transaction),
      memo,
    });
    const signed = response.data?.signedTransaction;
    if (!signed || !/^0x[0-9a-fA-F]+$/.test(signed)) {
      throw new Error("Circle did not return a valid signed EVM transaction");
    }
    return signed as Hex;
  }
}

export function createCircleTransactionSigner(
  credentials: CircleSignerCredentials,
  walletId: string,
): CircleTransactionSigner {
  if (!credentials.apiKey || !credentials.entitySecret) {
    throw new Error("Circle API key and entity secret are required");
  }
  const client = initiateDeveloperControlledWalletsClient(credentials);
  return new CircleTransactionSigner(client, walletId);
}

export interface SubmitAuthorization {
  attestation: WitnessAttestation;
  witnessSignature: Hex;
  ownerApproval?: Hex;
}

export class SimulationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationFailedError";
  }
}

/**
 * Circle signs; Arc RPC simulates, broadcasts, and reconciles. Retries first
 * inspect the obligation settlement event so a worker crash cannot repay it.
 */
export class CircleArcExecutor {
  private readonly config: ArcDeploymentConfig;
  private readonly client: PublicClient;

  constructor(
    rawConfig: ArcDeploymentConfig,
    private readonly signer: CircleTransactionSigner,
    private readonly simulator: ExecutionSimulator,
    client?: PublicClient,
  ) {
    this.config = ArcDeploymentConfigSchema.parse(rawConfig);
    this.client =
      client ??
      createPublicClient({
        chain: this.config.environment === "testnet" ? arcTestnet : arc,
        transport: http(this.config.rpcUrl),
      });
  }

  async submit(rawInput: SubmitAuthorization): Promise<Settlement> {
    const attestation = WitnessAttestationSchema.parse(rawInput.attestation);
    if (attestation.token.toLowerCase() !== this.config.usdcAddress.toLowerCase()) {
      throw new Error("Attestation token does not match configured Arc USDC");
    }
    const existing = await this.reconcile(attestation.obligationId as Hex);
    if (existing) return existing;

    const data = encodeReleaseCall(
      attestation,
      rawInput.witnessSignature,
      rawInput.ownerApproval ?? "0x",
    );
    const transaction: PreparedTransaction = {
      from: this.config.circleWalletAddress as Address,
      to: this.config.vaultAddress as Address,
      data,
      value: 0n,
    };
    const simulation = await this.simulator.simulate(transaction);
    if (!simulation.success) {
      throw new SimulationFailedError(simulation.revertReason ?? "Arc preflight failed");
    }

    const nonce = await this.client.getTransactionCount({ address: transaction.from });
    const gas = await this.client.estimateGas({
      account: transaction.from,
      to: transaction.to,
      data: transaction.data,
      value: 0n,
    });
    const fees = await this.client.estimateFeesPerGas();
    const maxFeePerGas =
      (fees.maxFeePerGas ?? 0n) < ARC_MIN_MAX_FEE_PER_GAS
        ? ARC_MIN_MAX_FEE_PER_GAS
        : (fees.maxFeePerGas ?? ARC_MIN_MAX_FEE_PER_GAS);
    const maxPriorityFeePerGas =
      (fees.maxPriorityFeePerGas ?? 0n) > maxFeePerGas
        ? maxFeePerGas
        : (fees.maxPriorityFeePerGas ?? 0n);
    const signed = await this.signer.sign(
      {
        chainId: this.config.chainId,
        nonce: nonce.toString(),
        to: transaction.to,
        data: transaction.data,
        value: "0",
        gas: gas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      },
      `Euthyna obligation ${attestation.obligationId}`,
    );

    try {
      const txHash = await this.client.sendRawTransaction({ serializedTransaction: signed });
      const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error(`Arc transaction reverted: ${txHash}`);
      }
      const settlement = await this.reconcile(attestation.obligationId as Hex);
      if (!settlement || settlement.txHash.toLowerCase() !== txHash.toLowerCase()) {
        throw new Error("Finalized transaction is missing the expected ObligationSettled event");
      }
      return { ...settlement, status: "FINAL" };
    } catch (error) {
      // A response can be lost after broadcast. Chain state is authoritative.
      const settlement = await this.reconcile(attestation.obligationId as Hex);
      if (settlement) return settlement;
      throw error;
    }
  }

  async reconcile(obligationId: Hex): Promise<Settlement | null> {
    const isSettled = await this.client.readContract({
      address: this.config.vaultAddress as Address,
      abi: OBLIGATION_VAULT_ABI,
      functionName: "settled",
      args: [obligationId],
    });
    if (!isSettled) return null;
    const logs = await this.client.getContractEvents({
      address: this.config.vaultAddress as Address,
      abi: OBLIGATION_VAULT_ABI,
      eventName: "ObligationSettled",
      args: { obligationId },
      fromBlock: BigInt(this.config.vaultDeploymentBlock),
      toBlock: "latest",
      strict: true,
    });
    const event = logs.at(-1);
    if (!event?.transactionHash || event.blockNumber === null) {
      throw new Error("Vault marks obligation settled but no settlement event was found");
    }
    const block = await this.client.getBlock({ blockNumber: event.blockNumber });
    return SettlementSchema.parse({
      chainId: this.config.chainId,
      network: this.config.environment === "testnet" ? "Arc Testnet" : "Arc",
      txHash: event.transactionHash,
      blockNumber: event.blockNumber.toString(),
      status: "RECONCILED",
      explorerUrl: arcExplorerTransactionUrl(this.config, event.transactionHash),
      finalizedAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
    });
  }
}

