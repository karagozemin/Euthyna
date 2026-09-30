import type { WitnessAttestation } from "@euthyna/domain";
import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { encodeReleaseCall, hashWitnessAttestation } from "./attestation.js";
import {
  CircleArcExecutor,
  CircleArcTransactionClient,
  circleIdempotencyKey,
} from "./circle-executor.js";

const vault = "0x1111111111111111111111111111111111111111" as Address;
const attestation: WitnessAttestation = {
  obligationId: `0x${"1".repeat(64)}`,
  operationId: `0x${"2".repeat(64)}`,
  businessIdHash: `0x${"3".repeat(64)}`,
  vendorIdHash: `0x${"4".repeat(64)}`,
  payee: "0x2222222222222222222222222222222222222222",
  token: "0x3600000000000000000000000000000000000000",
  amountMinor: "1000",
  evidenceRoot: `0x${"5".repeat(64)}`,
  decisionCommitmentHash: `0x${"6".repeat(64)}`,
  vendorVersion: 1,
  policyVersion: 1,
  witnessVersion: 1,
  rulesVersion: 1,
  validUntilUnix: "1800000000",
  chainId: "5042002",
  verifyingContract: vault,
};
const config = {
  environment: "testnet" as const,
  chainId: 5_042_002,
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://explorer.testnet.arc.io",
  vaultAddress: vault,
  vaultDeploymentBlock: "1",
  vaultBusinessIdHash: attestation.businessIdHash,
  witnessSignerAddress: "0x3333333333333333333333333333333333333333",
  usdcAddress: attestation.token,
  usdcErc20Decimals: 6,
  nativeGasDecimals: 18,
  circleWalletId: "b3d9d2d5-4c12-4946-a09d-953e82fae2b0",
  circleWalletAddress: "0x4444444444444444444444444444444444444444",
};

describe("Circle managed Arc transaction boundary", () => {
  it("submits only the exact prepared calldata with a stable idempotency key", async () => {
    const txHash = `0x${"1".repeat(64)}` as Hex;
    const createContractExecutionTransaction = vi.fn().mockResolvedValue({
      data: { id: "circle-tx-id", state: "INITIATED" },
    });
    const getTransaction = vi.fn().mockResolvedValue({
      data: {
        transaction: {
          id: "circle-tx-id",
          txHash,
          blockchain: "ARC-TESTNET",
          walletId: "wallet-id",
          sourceAddress: config.circleWalletAddress,
          contractAddress: vault,
          state: "SENT",
        },
      },
    });
    const circle = new CircleArcTransactionClient(
      { createContractExecutionTransaction, getTransaction, getWallet: vi.fn() },
      "wallet-id",
    );
    const callData = "0x1234" as Hex;
    const idempotencyKey = circleIdempotencyKey(`0x${"a".repeat(64)}`);
    await expect(
      circle.submitContractExecution({
        contractAddress: vault,
        callData,
        idempotencyKey,
        refId: "euthyna-test",
        expectedAddress: config.circleWalletAddress as Address,
      }),
    ).resolves.toEqual({ circleTransactionId: "circle-tx-id", txHash });
    expect(createContractExecutionTransaction).toHaveBeenCalledWith({
      walletId: "wallet-id",
      contractAddress: vault,
      callData,
      idempotencyKey,
      refId: "euthyna-test",
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    expect(getTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "circle-tx-id", waitForTxHash: true }),
    );
  });

  it("fails closed when Circle omits the managed transaction ID", async () => {
    const circle = new CircleArcTransactionClient(
      {
        createContractExecutionTransaction: vi.fn().mockResolvedValue({ data: {} }),
        getTransaction: vi.fn(),
        getWallet: vi.fn(),
      },
      "wallet-id",
    );
    await expect(
      circle.submitContractExecution({
        contractAddress: vault,
        callData: "0x1234",
        idempotencyKey: circleIdempotencyKey(`0x${"a".repeat(64)}`),
        refId: "euthyna-test",
        expectedAddress: config.circleWalletAddress as Address,
      }),
    ).rejects.toThrow(/transaction ID/);
  });

  it("verifies the Circle wallet ID against the configured signer address", async () => {
    const circle = new CircleArcTransactionClient(
      {
        createContractExecutionTransaction: vi.fn(),
        getTransaction: vi.fn(),
        getWallet: vi.fn().mockResolvedValue({
          data: {
            wallet: {
              address: config.circleWalletAddress,
              blockchain: "ARC-TESTNET",
              accountType: "EOA",
            },
          },
        }),
      },
      config.circleWalletId,
    );
    await expect(circle.assertWalletAddress(config.circleWalletAddress as Address)).resolves.toBeUndefined();
    await expect(
      circle.assertWalletAddress("0x5555555555555555555555555555555555555555"),
    ).rejects.toThrow(/identity/);
  });
});

describe("Circle Arc exact authorization reconciliation", () => {
  function makeClient(eventOverrides: Record<string, unknown> = {}) {
    return {
      readContract: vi.fn().mockResolvedValue(true),
      getContractEvents: vi.fn().mockResolvedValue([
        {
          args: {
            obligationId: attestation.obligationId,
            operationId: attestation.operationId,
            vendorIdHash: attestation.vendorIdHash,
            payee: attestation.payee,
            amount: BigInt(attestation.amountMinor),
            evidenceRoot: attestation.evidenceRoot,
            decisionCommitmentHash: attestation.decisionCommitmentHash,
            attestationHash: hashWitnessAttestation(config.chainId, vault, attestation),
            ...eventOverrides,
          },
          transactionHash: `0x${"8".repeat(64)}`,
          blockNumber: 12n,
        },
      ]),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_800_000_000n }),
    };
  }

  it("rejects an event sharing the obligation ID but not the exact authorization", async () => {
    const client = makeClient({ amount: 1001n });
    const executor = new CircleArcExecutor(
      config,
      {} as CircleArcTransactionClient,
      {} as never,
      client as never,
    );
    await expect(executor.reconcile(attestation)).rejects.toThrow(/amount/);
  });

  it("returns settlement details only when all emitted fields match", async () => {
    const client = makeClient();
    const executor = new CircleArcExecutor(
      config,
      {} as CircleArcTransactionClient,
      {} as never,
      client as never,
    );
    await expect(executor.reconcile(attestation)).resolves.toMatchObject({
      operationId: attestation.operationId,
      decisionCommitmentHash: attestation.decisionCommitmentHash,
      status: "RECONCILED",
    });
  });

  it("submits the exact release calldata through Circle with deterministic idempotency", async () => {
    const txHash = `0x${"8".repeat(64)}` as Hex;
    const client = makeClient();
    client.readContract.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    Object.assign(client, {
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    });
    const assertWalletAddress = vi.fn();
    const submitContractExecution = vi.fn().mockResolvedValue({
      txHash,
      circleTransactionId: "circle-tx-id",
    });
    const simulator = {
      simulate: vi.fn().mockResolvedValue({
        success: true,
        provider: "RPC",
        expectedBalanceDeltaMinor: "-1000",
        revertReason: null,
      }),
    };
    const afterBroadcast = vi.fn();
    const signature = `0x${"9".repeat(130)}` as Hex;
    const executor = new CircleArcExecutor(
      config,
      { assertWalletAddress, submitContractExecution } as unknown as CircleArcTransactionClient,
      simulator,
      client as never,
    );
    await expect(
      executor.submit({ attestation, witnessSignature: signature, afterBroadcast }),
    ).resolves.toMatchObject({ txHash, status: "FINAL" });
    const attestationHash = hashWitnessAttestation(config.chainId, vault, attestation);
    expect(submitContractExecution).toHaveBeenCalledWith({
      contractAddress: vault,
      callData: encodeReleaseCall(attestation, signature, "0x"),
      idempotencyKey: circleIdempotencyKey(attestationHash),
      refId: `euthyna-${attestation.operationId.slice(2, 34)}`,
      expectedAddress: config.circleWalletAddress,
    });
    expect(afterBroadcast).toHaveBeenCalledWith(txHash, "circle-tx-id");
  });

  it("reconciles a crash retry before invoking Circle or broadcasting again", async () => {
    const client = makeClient();
    const assertWalletAddress = vi.fn();
    const submitContractExecution = vi.fn();
    const executor = new CircleArcExecutor(
      config,
      { assertWalletAddress, submitContractExecution } as unknown as CircleArcTransactionClient,
      {} as never,
      client as never,
    );
    await expect(
      executor.submit({ attestation, witnessSignature: `0x${"9".repeat(130)}` }),
    ).resolves.toMatchObject({ txHash: `0x${"8".repeat(64)}` });
    expect(assertWalletAddress).not.toHaveBeenCalled();
    expect(submitContractExecution).not.toHaveBeenCalled();
    expect(client).not.toHaveProperty("sendRawTransaction");
  });
});
