import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { ArcDeploymentConfig } from "./arc-config.js";
import { runArcFundingPreflight } from "./preflight.js";

const config: ArcDeploymentConfig = {
  environment: "testnet",
  chainId: 5_042_002,
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://explorer.testnet.arc.io",
  vaultAddress: "0x1111111111111111111111111111111111111111",
  vaultDeploymentBlock: "1",
  vaultBusinessIdHash: `0x${"1".repeat(64)}`,
  witnessSignerAddress: "0x2222222222222222222222222222222222222222",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  usdcErc20Decimals: 6,
  nativeGasDecimals: 18,
  circleWalletId: "b3d9d2d5-4c12-4946-a09d-953e82fae2b0",
  circleWalletAddress: "0x3333333333333333333333333333333333333333",
};

function client(nativeBalance = 1n, vaultBalance = 1_000n) {
  return {
    getChainId: vi.fn().mockResolvedValue(config.chainId),
    getCode: vi.fn().mockResolvedValue("0x6000"),
    getBalance: vi.fn().mockResolvedValue(nativeBalance),
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "decimals") return 6;
      if (functionName === "balanceOf") return vaultBalance;
      if (functionName === "settlementToken") return config.usdcAddress;
      if (functionName === "vaultBusinessIdHash") return config.vaultBusinessIdHash;
      if (functionName === "witnessSigner") return config.witnessSignerAddress;
      throw new Error(`unexpected ${functionName}`);
    }),
  };
}

describe("Arc funding and deployment preflight", () => {
  it("reports only public configuration after checking every binding and balance", async () => {
    await expect(runArcFundingPreflight(config, 500n, client() as never)).resolves.toMatchObject({
      chainId: 5_042_002,
      circleWalletNativeGasBalance: "1",
      vaultUsdcBalanceMinor: "1000",
      requiredUsdcMinor: "500",
      usdcDecimals: 6,
      witnessSignerAddress: config.witnessSignerAddress as Address,
    });
  });

  it("fails closed when the Circle signer cannot pay Arc gas", async () => {
    await expect(runArcFundingPreflight(config, 500n, client(0n) as never)).rejects.toThrow(
      /no native Arc USDC/,
    );
  });

  it("fails closed when the vault lacks ERC-20 USDC", async () => {
    await expect(runArcFundingPreflight(config, 500n, client(1n, 499n) as never)).rejects.toThrow(
      /below required amount/,
    );
  });
});
