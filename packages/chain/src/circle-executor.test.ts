import type { WitnessAttestation } from "@euthyna/domain";
import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { hashWitnessAttestation } from "./attestation.js";
import { CircleArcExecutor, CircleTransactionSigner } from "./circle-executor.js";

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

describe("Circle transaction signer boundary", () => {
  it("sends only a serialized transaction request and returns signed bytes", async () => {
    const signTransaction = vi.fn().mockResolvedValue({
      data: { signedTransaction: "0x02abcd", txHash: `0x${"1".repeat(64)}` },
    });
    const signer = new CircleTransactionSigner({ signTransaction }, "wallet-id");
    await expect(
      signer.sign({ chainId: 5_042_002, nonce: "1", value: "0" }, "obligation"),
    ).resolves.toBe("0x02abcd");
    expect(signTransaction).toHaveBeenCalledWith({
      walletId: "wallet-id",
      transaction: JSON.stringify({ chainId: 5_042_002, nonce: "1", value: "0" }),
      memo: "obligation",
    });
  });

  it("fails closed when Circle omits signed transaction bytes", async () => {
    const signer = new CircleTransactionSigner(
      { signTransaction: vi.fn().mockResolvedValue({ data: {} }) },
      "wallet-id",
    );
    await expect(signer.sign({ chainId: 5_042_002 }, "obligation")).rejects.toThrow(
      /valid signed EVM transaction/,
    );
  });

  it("verifies the Circle wallet ID against the configured signer address", async () => {
    const signer = new CircleTransactionSigner(
      {
        signTransaction: vi.fn(),
        getWallet: vi.fn().mockResolvedValue({
          data: { wallet: { address: config.circleWalletAddress } },
        }),
      },
      config.circleWalletId,
    );
    await expect(signer.assertWalletAddress(config.circleWalletAddress as Address)).resolves.toBeUndefined();
    await expect(
      signer.assertWalletAddress("0x5555555555555555555555555555555555555555"),
    ).rejects.toThrow(/does not match/);
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
      {} as CircleTransactionSigner,
      {} as never,
      client as never,
    );
    await expect(executor.reconcile(attestation)).rejects.toThrow(/amount/);
  });

  it("returns settlement details only when all emitted fields match", async () => {
    const client = makeClient();
    const executor = new CircleArcExecutor(
      config,
      {} as CircleTransactionSigner,
      {} as never,
      client as never,
    );
    await expect(executor.reconcile(attestation)).resolves.toMatchObject({
      operationId: attestation.operationId,
      decisionCommitmentHash: attestation.decisionCommitmentHash,
      status: "RECONCILED",
    });
  });

  it("reconciles a crash retry before invoking Circle or broadcasting again", async () => {
    const client = makeClient();
    const assertWalletAddress = vi.fn();
    const sign = vi.fn();
    const executor = new CircleArcExecutor(
      config,
      { assertWalletAddress, sign } as unknown as CircleTransactionSigner,
      {} as never,
      client as never,
    );
    await expect(
      executor.submit({ attestation, witnessSignature: `0x${"9".repeat(130)}` }),
    ).resolves.toMatchObject({ txHash: `0x${"8".repeat(64)}` });
    expect(assertWalletAddress).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(client).not.toHaveProperty("sendRawTransaction");
  });
});
