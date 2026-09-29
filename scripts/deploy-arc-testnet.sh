#!/usr/bin/env bash
set -euo pipefail

required=(
  ARC_DEPLOYER_PRIVATE_KEY ARC_RPC_URL ARC_USDC_ADDRESS VAULT_OWNER_ADDRESS
  WITNESS_SIGNER_ADDRESS VAULT_BUSINESS_ID_HASH VAULT_PER_PAYMENT_CAP_MINOR
  VAULT_APPROVAL_THRESHOLD_MINOR VAULT_INITIAL_FUNDING_MINOR TEST_VENDOR_ID_HASH
  TEST_VENDOR_PAYEE_ADDRESS
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing deployment from a dirty worktree; commit the exact source first" >&2
  exit 1
fi

if [[ "$(cast chain-id --rpc-url "${ARC_RPC_URL}")" != "5042002" ]]; then
  echo "Refusing deployment: RPC is not Arc Testnet chain ID 5042002" >&2
  exit 1
fi
normalized_usdc="$(printf '%s' "${ARC_USDC_ADDRESS}" | tr '[:upper:]' '[:lower:]')"
if [[ "${normalized_usdc}" != "0x3600000000000000000000000000000000000000" ]]; then
  echo "Refusing deployment: ARC_USDC_ADDRESS is not the official Arc USDC ERC-20 interface" >&2
  exit 1
fi

forge script script/DeployObligationVault.s.sol:DeployObligationVault \
  --root contracts \
  --rpc-url "${ARC_RPC_URL}" \
  --broadcast \
  --slow

run_file="contracts/broadcast/DeployObligationVault.s.sol/5042002/run-latest.json"
vault_address="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .contractAddress' "${run_file}" | head -n 1)"
deployment_tx="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .hash' "${run_file}" | head -n 1)"
if [[ -z "${vault_address}" || "${vault_address}" == "null" || -z "${deployment_tx}" || "${deployment_tx}" == "null" ]]; then
  echo "Unable to resolve deployment metadata from ${run_file}" >&2
  exit 1
fi

receipt_json="$(cast receipt "${deployment_tx}" --rpc-url "${ARC_RPC_URL}" --json)"
block_hex="$(jq -r '.blockNumber' <<<"${receipt_json}")"
deployment_block="$(cast to-dec "${block_hex}")"
runtime_code_hash="$(cast code "${vault_address}" --rpc-url "${ARC_RPC_URL}" | cast keccak)"
source_commit="$(git rev-parse HEAD)"
verification_status="not_attempted"
mkdir -p deployments
jq -n \
  --arg network "Arc Testnet" \
  --argjson chainId 5042002 \
  --arg rpcUrl "${ARC_RPC_URL}" \
  --arg explorerUrl "https://explorer.testnet.arc.io" \
  --arg vaultAddress "${vault_address}" \
  --arg deploymentTxHash "${deployment_tx}" \
  --arg deploymentBlock "${deployment_block}" \
  --arg runtimeCodeHash "${runtime_code_hash}" \
  --arg owner "${VAULT_OWNER_ADDRESS}" \
  --arg witnessSigner "${WITNESS_SIGNER_ADDRESS}" \
  --arg vaultBusinessIdHash "${VAULT_BUSINESS_ID_HASH}" \
  --arg usdcAddress "${ARC_USDC_ADDRESS}" \
  --arg perPaymentCapMinor "${VAULT_PER_PAYMENT_CAP_MINOR}" \
  --arg approvalThresholdMinor "${VAULT_APPROVAL_THRESHOLD_MINOR}" \
  --arg initialFundingMinor "${VAULT_INITIAL_FUNDING_MINOR}" \
  --arg testVendorIdHash "${TEST_VENDOR_ID_HASH}" \
  --arg testVendorPayee "${TEST_VENDOR_PAYEE_ADDRESS}" \
  --arg sourceCommit "${source_commit}" \
  --arg deployedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg verificationStatus "${verification_status}" \
  '{network:$network,chainId:$chainId,rpcUrl:$rpcUrl,explorerUrl:$explorerUrl,vaultAddress:$vaultAddress,deploymentTxHash:$deploymentTxHash,deploymentBlock:$deploymentBlock,runtimeCodeHash:$runtimeCodeHash,owner:$owner,witnessSigner:$witnessSigner,witnessVersion:1,rulesVersion:1,policyVersion:1,vaultBusinessIdHash:$vaultBusinessIdHash,usdcAddress:$usdcAddress,usdcErc20Decimals:6,nativeGasDecimals:18,perPaymentCapMinor:$perPaymentCapMinor,approvalThresholdMinor:$approvalThresholdMinor,initialFundingMinor:$initialFundingMinor,testVendorIdHash:$testVendorIdHash,testVendorPayee:$testVendorPayee,sourceCommit:$sourceCommit,deployedAt:$deployedAt,verificationStatus:$verificationStatus}' \
  > deployments/arc-testnet.json

if [[ "${VERIFY_CONTRACT:-YES}" == "YES" ]]; then
  constructor_args="$(cast abi-encode 'constructor(address,address,bytes32,address,uint256,uint256)' \
    "${VAULT_OWNER_ADDRESS}" \
    "${WITNESS_SIGNER_ADDRESS}" \
    "${VAULT_BUSINESS_ID_HASH}" \
    "${ARC_USDC_ADDRESS}" \
    "${VAULT_PER_PAYMENT_CAP_MINOR}" \
    "${VAULT_APPROVAL_THRESHOLD_MINOR}")"
  if forge verify-contract \
    --root contracts \
    --chain-id 5042002 \
    --verifier blockscout \
    --verifier-url "${ARC_VERIFIER_URL:-https://explorer.testnet.arc.io/api/}" \
    --constructor-args "${constructor_args}" \
    --watch \
    "${vault_address}" \
    src/ObligationVault.sol:ObligationVault; then
    verification_status="verified"
  else
    verification_status="failed"
  fi
  metadata_tmp="$(mktemp)"
  jq --arg status "${verification_status}" '.verificationStatus = $status' deployments/arc-testnet.json > "${metadata_tmp}"
  mv "${metadata_tmp}" deployments/arc-testnet.json
fi

echo "Vault deployed at ${vault_address}"
echo "Deployment transaction ${deployment_tx}"
echo "Verification status ${verification_status}"
echo "Public metadata written to deployments/arc-testnet.json"
