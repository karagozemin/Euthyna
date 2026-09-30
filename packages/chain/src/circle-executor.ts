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
import {
  encodeReleaseCall,
  hashWitnessAttestation,
  OBLIGATION_VAULT_ABI,
} from "./attestation.js";
import type { ExecutionSimulator, PreparedTransaction } from "./simulator.js";

export interface CircleManagedWalletClient {
  createContractExecutionTransaction(input: {
    walletId: string;
    contractAddress: string;
    callData: Hex;
    idempotencyKey: string;
    refId: string;
    fee: { type: "level"; config: { feeLevel: "MEDIUM" } };
  }): Promise<{ data?: { id?: string; state?: string } }>;
  getTransaction(input: {
    id: string;
    waitForTxHash: true;
    pollingInterval: number;
    signal: AbortSignal;
  }): Promise<{
    data?: {
      transaction?: {
        id?: string;
        txHash?: string;
        blockchain?: string;
        walletId?: string;
        sourceAddress?: string;
        contractAddress?: string;
        state?: string;
      };
    };
  }>;
  getWallet(input: {
    id: string;
  }): Promise<{
    data?: {
      wallet?: { address?: string; blockchain?: string; accountType?: string };
    };
  }>;
}

export interface CircleSignerCredentials {
  apiKey: string;
  entitySecret: string;
}

export interface CircleSubmittedTransaction {
  circleTransactionId: string;
  txHash: Hex;
}

export function circleIdempotencyKey(attestationHash: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(attestationHash)) {
    throw new Error("Circle idempotency input must be a 32-byte hash");
  }
  const bytes = Uint8Array.from(Buffer.from(attestationHash.slice(2, 34), "hex"));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class CircleArcTransactionClient {
  constructor(
    private readonly client: CircleManagedWalletClient,
    private readonly walletId: string,
  ) {}

  async submitContractExecution(input: {
    contractAddress: Address;
    callData: Hex;
    idempotencyKey: string;
    refId: string;
    expectedAddress: Address;
  }): Promise<CircleSubmittedTransaction> {
    const response = await this.client.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress: input.contractAddress,
      callData: input.callData,
      idempotencyKey: input.idempotencyKey,
      refId: input.refId,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const transactionId = response.data?.id;
    if (!transactionId) {
      throw new Error("Circle did not return a managed transaction ID");
    }
    const final = (
      await this.client.getTransaction({
        id: transactionId,
        waitForTxHash: true,
        pollingInterval: 1_000,
        signal: AbortSignal.timeout(120_000),
      })
    ).data?.transaction;
    if (
      !final ||
      final.id !== transactionId ||
      final.walletId !== this.walletId ||
      final.blockchain !== "ARC-TESTNET" ||
      final.sourceAddress?.toLowerCase() !== input.expectedAddress.toLowerCase() ||
      final.contractAddress?.toLowerCase() !== input.contractAddress.toLowerCase() ||
      !final.txHash ||
      !/^0x[0-9a-fA-F]{64}$/u.test(final.txHash)
    ) {
      throw new Error("Circle managed transaction identity does not match the prepared Arc call");
    }
    return { circleTransactionId: transactionId, txHash: final.txHash as Hex };
  }

  async assertWalletAddress(expectedAddress: Address): Promise<void> {
    const response = await this.client.getWallet({ id: this.walletId });
    const wallet = response.data?.wallet;
    if (
      !wallet?.address ||
      wallet.address.toLowerCase() !== expectedAddress.toLowerCase() ||
      wallet.blockchain !== "ARC-TESTNET" ||
      wallet.accountType !== "EOA"
    ) {
      throw new Error("Circle wallet identity is not the configured Arc Testnet EOA");
    }
  }
}

export function createCircleArcTransactionClient(
  credentials: CircleSignerCredentials,
  walletId: string,
): CircleArcTransactionClient {
  if (!credentials.apiKey || !credentials.entitySecret) {
    throw new Error("Circle API key and entity secret are required");
  }
  const client = initiateDeveloperControlledWalletsClient(credentials);
  return new CircleArcTransactionClient(client, walletId);
}

export interface SubmitAuthorization {
  attestation: WitnessAttestation;
  witnessSignature: Hex;
  ownerApproval?: Hex;
  /** Testnet/operator hook used to prove recovery from a process exit after broadcast. */
  afterBroadcast?: (txHash: Hex, circleTransactionId: string) => Promise<void> | void;
}

export class SimulationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationFailedError";
  }
}

/**
 * Arc RPC simulates, Circle signs and broadcasts the exact prepared call, and
 * reconciliation treats chain state as authoritative. Retries inspect the
 * settlement event first, while a deterministic Circle idempotency key also
 * protects the response-lost-before-checkpoint boundary.
 */
export class CircleArcExecutor {
  private readonly config: ArcDeploymentConfig;
  private readonly client: PublicClient;

  constructor(
    rawConfig: ArcDeploymentConfig,
    private readonly circle: CircleArcTransactionClient,
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
    const existing = await this.reconcile(attestation);
    if (existing) return existing;
    await this.circle.assertWalletAddress(this.config.circleWalletAddress as Address);

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

    try {
      const attestationHash = hashWitnessAttestation(
        this.config.chainId,
        this.config.vaultAddress as Address,
        attestation,
      );
      const { txHash, circleTransactionId } = await this.circle.submitContractExecution({
        contractAddress: transaction.to,
        callData: transaction.data,
        idempotencyKey: circleIdempotencyKey(attestationHash),
        refId: `euthyna-${attestation.operationId.slice(2, 34)}`,
        expectedAddress: transaction.from,
      });
      await rawInput.afterBroadcast?.(txHash, circleTransactionId);
      const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error(`Arc transaction reverted: ${txHash}`);
      }
      const settlement = await this.reconcile(attestation);
      if (!settlement || settlement.txHash.toLowerCase() !== txHash.toLowerCase()) {
        throw new Error("Finalized transaction is missing the expected ObligationSettled event");
      }
      return { ...settlement, status: "FINAL" };
    } catch (error) {
      // A response can be lost after broadcast. Chain state is authoritative.
      const settlement = await this.reconcile(attestation);
      if (settlement) return settlement;
      throw error;
    }
  }

  async reconcile(rawAttestation: WitnessAttestation): Promise<Settlement | null> {
    const attestation = WitnessAttestationSchema.parse(rawAttestation);
    const obligationId = attestation.obligationId as Hex;
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
    const expectedAttestationHash = hashWitnessAttestation(
      this.config.chainId,
      this.config.vaultAddress as Address,
      attestation,
    );
    const equalAuthorizationField = (observed: unknown, expected: unknown): boolean => {
      if (typeof observed === "string" && typeof expected === "string") {
        return observed.startsWith("0x") && expected.startsWith("0x")
          ? observed.toLowerCase() === expected.toLowerCase()
          : observed === expected;
      }
      return observed === expected;
    };
    const mismatches = [
      ["operationId", event.args.operationId, attestation.operationId],
      ["vendorIdHash", event.args.vendorIdHash, attestation.vendorIdHash],
      ["payee", event.args.payee?.toLowerCase(), attestation.payee.toLowerCase()],
      ["amount", event.args.amount?.toString(), attestation.amountMinor],
      ["evidenceRoot", event.args.evidenceRoot, attestation.evidenceRoot],
      [
        "decisionCommitmentHash",
        event.args.decisionCommitmentHash,
        attestation.decisionCommitmentHash,
      ],
      ["attestationHash", event.args.attestationHash, expectedAttestationHash],
    ].filter(([, observed, expected]) => !equalAuthorizationField(observed, expected));
    if (mismatches.length > 0) {
      throw new Error(
        `Settled obligation event does not match submitted authorization: ${mismatches
          .map(([field]) => field)
          .join(", ")}`,
      );
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
      operationId: attestation.operationId,
      vendorIdHash: attestation.vendorIdHash,
      payee: attestation.payee,
      amountMinor: attestation.amountMinor,
      evidenceRoot: attestation.evidenceRoot,
      decisionCommitmentHash: attestation.decisionCommitmentHash,
      attestationHash: expectedAttestationHash,
    });
  }
}
