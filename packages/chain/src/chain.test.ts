import type { WitnessAttestation } from "@euthyna/domain";
import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address } from "viem";
import { ArcDeploymentConfigSchema } from "./arc-config.js";
import { encodeReleaseCall, hashWitnessAttestation, OBLIGATION_VAULT_ABI } from "./attestation.js";
import { RpcExecutionSimulator } from "./simulator.js";

const vault = "0x1111111111111111111111111111111111111111";
const attestation: WitnessAttestation = {
  obligationId: `0x${"1".repeat(64)}`,
  operationId: `0x${"6".repeat(64)}`,
  businessIdHash: `0x${"2".repeat(64)}`,
  vendorIdHash: `0x${"3".repeat(64)}`,
  payee: "0x2222222222222222222222222222222222222222",
  token: "0x3600000000000000000000000000000000000000",
  amountMinor: "125000000",
  evidenceRoot: `0x${"4".repeat(64)}`,
  decisionCommitmentHash: `0x${"5".repeat(64)}`,
  vendorVersion: 3,
  policyVersion: 5,
  witnessVersion: 2,
  rulesVersion: 4,
  validUntilUnix: "1800000600",
  chainId: "5042002",
  verifyingContract: vault,
};

describe("Arc authorization adapter", () => {
  it("separates ERC-20 USDC units from native gas units", () => {
    expect(
      ArcDeploymentConfigSchema.parse({
        environment: "testnet",
        chainId: 5_042_002,
        rpcUrl: "https://rpc.testnet.arc.io",
        explorerUrl: "https://explorer.testnet.arc.io",
        vaultAddress: vault,
        vaultDeploymentBlock: "1",
        vaultBusinessIdHash: attestation.businessIdHash,
        witnessSignerAddress: "0x4444444444444444444444444444444444444444",
        usdcAddress: attestation.token,
        usdcErc20Decimals: 6,
        nativeGasDecimals: 18,
        circleWalletId: "b3d9d2d5-4c12-4946-a09d-953e82fae2b0",
        circleWalletAddress: "0x3333333333333333333333333333333333333333",
      }).chainId,
    ).toBe(5_042_002);
    expect(() =>
      ArcDeploymentConfigSchema.parse({
        environment: "testnet",
        chainId: 5_042_002,
        rpcUrl: "https://rpc.testnet.arc.io",
        explorerUrl: "https://explorer.testnet.arc.io",
        vaultAddress: vault,
        vaultDeploymentBlock: "1",
        vaultBusinessIdHash: attestation.businessIdHash,
        witnessSignerAddress: "0x4444444444444444444444444444444444444444",
        usdcAddress: attestation.token,
        usdcErc20Decimals: 18,
        nativeGasDecimals: 18,
        circleWalletId: "b3d9d2d5-4c12-4946-a09d-953e82fae2b0",
        circleWalletAddress: "0x3333333333333333333333333333333333333333",
      }),
    ).toThrow(/ERC-20 transfer units use 6 decimals/);
  });

  it("encodes the exact contract attestation and hashes EIP-712 deterministically", () => {
    const calldata = encodeReleaseCall(attestation, `0x${"a".repeat(130)}`);
    const decoded = decodeFunctionData({ abi: OBLIGATION_VAULT_ABI, data: calldata });
    expect(decoded.functionName).toBe("release");
    expect(hashWitnessAttestation(5_042_002, vault, attestation)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("fails simulation explicitly and never treats it as evidence", async () => {
    const client = { call: vi.fn().mockRejectedValue(new Error("execution reverted")) };
    const simulator = new RpcExecutionSimulator(client, "-125000000");
    await expect(
      simulator.simulate({
        from: attestation.payee as Address,
        to: vault,
        data: "0x",
        value: 0n,
      }),
    ).resolves.toMatchObject({ success: false, provider: "RPC", expectedBalanceDeltaMinor: "0" });
  });
});
