import { AddressSchema, Hex32Schema } from "@euthyna/domain";
import { z } from "zod";

export const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000" as const;

export const ArcDeploymentConfigSchema = z
  .object({
    environment: z.enum(["testnet", "mainnet"]),
    chainId: z.number().int().positive(),
    rpcUrl: z.string().url(),
    explorerUrl: z.string().url(),
    vaultAddress: AddressSchema,
    vaultDeploymentBlock: z.string().regex(/^(0|[1-9][0-9]*)$/),
    vaultBusinessIdHash: Hex32Schema,
    witnessSignerAddress: AddressSchema,
    usdcAddress: AddressSchema,
    usdcErc20Decimals: z.number().int(),
    nativeGasDecimals: z.number().int(),
    circleWalletId: z.string().uuid(),
    circleWalletAddress: AddressSchema,
  })
  .superRefine((config, context) => {
    const expectedChainId = config.environment === "testnet" ? 5_042_002 : 5_042;
    if (config.chainId !== expectedChainId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chainId"],
        message: `Arc ${config.environment} chain ID must be ${expectedChainId}`,
      });
    }
    if (config.usdcAddress.toLowerCase() !== ARC_USDC_ERC20.toLowerCase()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usdcAddress"],
        message: "Arc settlement must use the official USDC ERC-20 interface",
      });
    }
    if (config.usdcErc20Decimals !== 6) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usdcErc20Decimals"],
        message: "Arc USDC ERC-20 transfer units use 6 decimals",
      });
    }
    if (config.nativeGasDecimals !== 18) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nativeGasDecimals"],
        message: "Arc native USDC gas units use 18 decimals",
      });
    }
  });

export type ArcDeploymentConfig = z.infer<typeof ArcDeploymentConfigSchema>;

export function arcExplorerTransactionUrl(config: ArcDeploymentConfig, txHash: string): string {
  return `${config.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

export function loadArcDeploymentConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ArcDeploymentConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  return ArcDeploymentConfigSchema.parse({
    environment: required("ARC_ENVIRONMENT"),
    chainId: Number(required("ARC_CHAIN_ID")),
    rpcUrl: required("ARC_RPC_URL"),
    explorerUrl: required("ARC_EXPLORER_URL"),
    vaultAddress: required("OBLIGATION_VAULT_ADDRESS"),
    vaultDeploymentBlock: required("OBLIGATION_VAULT_DEPLOYMENT_BLOCK"),
    vaultBusinessIdHash: required("VAULT_BUSINESS_ID_HASH"),
    witnessSignerAddress: required("WITNESS_SIGNER_ADDRESS"),
    usdcAddress: required("ARC_USDC_ADDRESS"),
    usdcErc20Decimals: Number(required("ARC_USDC_ERC20_DECIMALS")),
    nativeGasDecimals: Number(required("ARC_NATIVE_GAS_DECIMALS")),
    circleWalletId: required("CIRCLE_WALLET_ID"),
    circleWalletAddress: required("CIRCLE_WALLET_ADDRESS"),
  });
}
