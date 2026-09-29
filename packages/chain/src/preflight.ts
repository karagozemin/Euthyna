import { type Address, createPublicClient, http, type PublicClient } from "viem";
import { arc, arcTestnet } from "viem/chains";
import type { ArcDeploymentConfig } from "./arc-config.js";
import { ArcDeploymentConfigSchema } from "./arc-config.js";
import { OBLIGATION_VAULT_ABI } from "./attestation.js";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export interface ArcFundingPreflight {
  chainId: number;
  circleWalletAddress: Address;
  circleWalletNativeGasBalance: string;
  vaultAddress: Address;
  vaultUsdcBalanceMinor: string;
  requiredUsdcMinor: string;
  usdcAddress: Address;
  usdcDecimals: number;
  vaultBusinessIdHash: `0x${string}`;
  witnessSignerAddress: Address;
}

export async function runArcFundingPreflight(
  rawConfig: ArcDeploymentConfig,
  requiredUsdcMinor: bigint,
  client?: PublicClient,
): Promise<ArcFundingPreflight> {
  const config = ArcDeploymentConfigSchema.parse(rawConfig);
  if (requiredUsdcMinor <= 0n) throw new Error("Required settlement amount must be positive");
  const publicClient =
    client ??
    createPublicClient({
      chain: config.environment === "testnet" ? arcTestnet : arc,
      transport: http(config.rpcUrl),
    });

  const chainId = await publicClient.getChainId();
  if (chainId !== config.chainId) throw new Error(`Arc RPC chain ID mismatch: ${chainId}`);
  const vaultCode = await publicClient.getCode({ address: config.vaultAddress as Address });
  if (!vaultCode || vaultCode === "0x") throw new Error("Configured ObligationVault has no bytecode");

  const [nativeBalance, decimals, vaultBalance, token, businessHash, witnessSigner] =
    await Promise.all([
      publicClient.getBalance({ address: config.circleWalletAddress as Address }),
      publicClient.readContract({
        address: config.usdcAddress as Address,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: config.usdcAddress as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [config.vaultAddress as Address],
      }),
      publicClient.readContract({
        address: config.vaultAddress as Address,
        abi: OBLIGATION_VAULT_ABI,
        functionName: "settlementToken",
      }),
      publicClient.readContract({
        address: config.vaultAddress as Address,
        abi: OBLIGATION_VAULT_ABI,
        functionName: "vaultBusinessIdHash",
      }),
      publicClient.readContract({
        address: config.vaultAddress as Address,
        abi: OBLIGATION_VAULT_ABI,
        functionName: "witnessSigner",
      }),
    ]);

  if (nativeBalance === 0n) throw new Error("Circle signer has no native Arc USDC for gas");
  if (Number(decimals) !== config.usdcErc20Decimals) throw new Error("USDC decimal mismatch");
  if ((token as string).toLowerCase() !== config.usdcAddress.toLowerCase()) {
    throw new Error("Vault settlement token does not match configured Arc USDC");
  }
  if ((businessHash as string).toLowerCase() !== config.vaultBusinessIdHash.toLowerCase()) {
    throw new Error("Vault business binding does not match configuration");
  }
  if ((witnessSigner as string).toLowerCase() !== config.witnessSignerAddress.toLowerCase()) {
    throw new Error("On-chain witness signer does not match explicit configuration");
  }
  if (vaultBalance < requiredUsdcMinor) {
    throw new Error(
      `Vault USDC balance ${vaultBalance} is below required amount ${requiredUsdcMinor}`,
    );
  }

  return {
    chainId,
    circleWalletAddress: config.circleWalletAddress as Address,
    circleWalletNativeGasBalance: nativeBalance.toString(),
    vaultAddress: config.vaultAddress as Address,
    vaultUsdcBalanceMinor: vaultBalance.toString(),
    requiredUsdcMinor: requiredUsdcMinor.toString(),
    usdcAddress: config.usdcAddress as Address,
    usdcDecimals: Number(decimals),
    vaultBusinessIdHash: businessHash as `0x${string}`,
    witnessSignerAddress: witnessSigner as Address,
  };
}
