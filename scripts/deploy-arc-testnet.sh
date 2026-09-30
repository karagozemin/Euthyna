#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts_root="${repo_root}/contracts"
arc_forge="${ARC_FORGE_BIN:-arc-forge}"
arc_cast="${ARC_CAST_BIN:-arc-cast}"

if ! command -v "${arc_forge}" >/dev/null 2>&1; then
  echo "Missing Arc Foundry binary: ${arc_forge}" >&2
  exit 1
fi
if ! command -v "${arc_cast}" >/dev/null 2>&1; then
  echo "Missing Arc Foundry binary: ${arc_cast}" >&2
  exit 1
fi

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

if [[ -n "$(git -C "${repo_root}" status --porcelain)" ]]; then
  echo "Refusing deployment from a dirty worktree; commit the exact source first" >&2
  exit 1
fi

if [[ "$("${arc_cast}" chain-id --rpc-url "${ARC_RPC_URL}")" != "5042002" ]]; then
  echo "Refusing deployment: RPC is not Arc Testnet chain ID 5042002" >&2
  exit 1
fi
normalized_usdc="$(printf '%s' "${ARC_USDC_ADDRESS}" | tr '[:upper:]' '[:lower:]')"
if [[ "${normalized_usdc}" != "0x3600000000000000000000000000000000000000" ]]; then
  echo "Refusing deployment: ARC_USDC_ADDRESS is not the official Arc USDC ERC-20 interface" >&2
  exit 1
fi

(
  cd "${contracts_root}"
  "${arc_forge}" script script/DeployObligationVault.s.sol:DeployObligationVault \
    --rpc-url "${ARC_RPC_URL}" \
    --broadcast \
    --slow
)

run_file="${contracts_root}/broadcast/DeployObligationVault.s.sol/5042002/run-latest.json"
vault_address="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .contractAddress' "${run_file}" | head -n 1)"
deployment_tx="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .hash' "${run_file}" | head -n 1)"
if [[ -z "${vault_address}" || "${vault_address}" == "null" || -z "${deployment_tx}" || "${deployment_tx}" == "null" ]]; then
  echo "Unable to resolve deployment metadata from ${run_file}" >&2
  exit 1
fi

receipt_json="$("${arc_cast}" receipt "${deployment_tx}" --rpc-url "${ARC_RPC_URL}" --json)"
block_hex="$(jq -r '.blockNumber' <<<"${receipt_json}")"
deployment_block="$("${arc_cast}" to-dec "${block_hex}")"
runtime_code_hash="$("${arc_cast}" code "${vault_address}" --rpc-url "${ARC_RPC_URL}" | "${arc_cast}" keccak)"
source_commit="$(git -C "${repo_root}" rev-parse HEAD)"
verification_status="not_attempted"
mkdir -p "${repo_root}/deployments"
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
  > "${repo_root}/deployments/arc-testnet.json"

if [[ "${VERIFY_CONTRACT:-YES}" == "YES" ]]; then
  constructor_args="$("${arc_cast}" abi-encode 'constructor(address,address,bytes32,address,uint256,uint256)' \
    "${VAULT_OWNER_ADDRESS}" \
    "${WITNESS_SIGNER_ADDRESS}" \
    "${VAULT_BUSINESS_ID_HASH}" \
    "${ARC_USDC_ADDRESS}" \
    "${VAULT_PER_PAYMENT_CAP_MINOR}" \
    "${VAULT_APPROVAL_THRESHOLD_MINOR}")"
  if (
    cd "${contracts_root}"
    "${arc_forge}" verify-contract \
      --chain-id 5042002 \
      --verifier blockscout \
      --verifier-url "${ARC_VERIFIER_URL:-https://explorer.testnet.arc.io/api/}" \
      --constructor-args "${constructor_args}" \
      --watch \
      "${vault_address}" \
      src/ObligationVault.sol:ObligationVault
  ); then
    verification_status="verified"
  else
    verification_status="failed"
  fi
  metadata_tmp="$(mktemp)"
  jq --arg status "${verification_status}" '.verificationStatus = $status' "${repo_root}/deployments/arc-testnet.json" > "${metadata_tmp}"
  mv "${metadata_tmp}" "${repo_root}/deployments/arc-testnet.json"
fi

echo "Vault deployed at ${vault_address}"
echo "Deployment transaction ${deployment_tx}"
echo "Verification status ${verification_status}"
echo "Public metadata written to ${repo_root}/deployments/arc-testnet.json"
