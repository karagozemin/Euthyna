// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal authority layer for proof-backed, one-time USDC obligations.
/// @dev This contract does not interpret invoices. It enforces the exact output of
///      the independent Evidence Witness against current owner policy.
contract ObligationVault is EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Vendor {
        address payout;
        uint64 version;
        bool active;
    }

    struct WitnessAttestation {
        bytes32 obligationId;
        bytes32 operationId;
        bytes32 businessIdHash;
        bytes32 vendorIdHash;
        address payee;
        address token;
        uint256 amount;
        bytes32 evidenceRoot;
        bytes32 receiptHash;
        uint64 vendorVersion;
        uint64 policyVersion;
        uint64 witnessVersion;
        uint64 rulesVersion;
        uint64 validUntil;
        uint256 chainId;
        address verifyingContract;
    }

    bytes32 public constant WITNESS_ATTESTATION_TYPEHASH = keccak256(
        "WitnessAttestation(bytes32 obligationId,bytes32 operationId,bytes32 businessIdHash,bytes32 vendorIdHash,address payee,address token,uint256 amount,bytes32 evidenceRoot,bytes32 receiptHash,uint64 vendorVersion,uint64 policyVersion,uint64 witnessVersion,uint64 rulesVersion,uint64 validUntil,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant OWNER_APPROVAL_TYPEHASH =
        keccak256("OwnerApproval(bytes32 attestationHash,uint64 deadline)");

    IERC20 public immutable settlementToken;
    address public witnessSigner;
    uint256 public perPaymentCap;
    uint256 public approvalThreshold;
    uint64 public policyVersion;
    uint64 public witnessVersion;
    uint64 public rulesVersion;

    mapping(bytes32 vendorIdHash => Vendor vendor) public vendors;
    mapping(bytes32 obligationId => bool isSettled) public settled;
    mapping(bytes32 operationId => bool isUsed) public usedOperations;

    error ZeroAddress();
    error InvalidAmount();
    error InvalidCommitment();
    error ObligationAlreadySettled(bytes32 obligationId);
    error OperationAlreadyUsed(bytes32 operationId);
    error AttestationExpired(uint64 validUntil);
    error StalePolicyVersion(uint64 supplied, uint64 current);
    error StaleVendorVersion(uint64 supplied, uint64 current);
    error StaleWitnessVersion(uint64 supplied, uint64 current);
    error StaleRulesVersion(uint64 supplied, uint64 current);
    error ChainIdMismatch(uint256 supplied, uint256 current);
    error VerifyingContractMismatch(address supplied, address current);
    error VendorInactive(bytes32 vendorIdHash);
    error PayeeMismatch(address supplied, address current);
    error TokenMismatch(address supplied, address expected);
    error PaymentCapExceeded(uint256 amount, uint256 cap);
    error InvalidWitnessSignature();
    error OwnerApprovalRequired();
    error OwnerApprovalExpired(uint64 deadline);
    error InvalidOwnerApproval();

    event VendorSet(bytes32 indexed vendorIdHash, address indexed payout, uint64 version);
    event VendorDeactivated(bytes32 indexed vendorIdHash, uint64 version);
    event WitnessSignerSet(address indexed signer);
    event RulesVersionSet(uint64 indexed version);
    event PolicySet(uint64 indexed version, uint256 perPaymentCap, uint256 approvalThreshold);
    event ObligationSettled(
        bytes32 indexed obligationId,
        bytes32 indexed vendorIdHash,
        address indexed payee,
        uint256 amount,
        bytes32 evidenceRoot,
        bytes32 receiptHash
    );

    constructor(
        address initialOwner,
        address initialWitnessSigner,
        IERC20 token,
        uint256 initialPerPaymentCap,
        uint256 initialApprovalThreshold
    ) EIP712("Euthyna ObligationVault", "1") Ownable(initialOwner) {
        if (initialOwner == address(0) || initialWitnessSigner == address(0) || address(token) == address(0)) {
            revert ZeroAddress();
        }
        if (initialPerPaymentCap == 0 || initialApprovalThreshold > initialPerPaymentCap) {
            revert InvalidAmount();
        }
        settlementToken = token;
        witnessSigner = initialWitnessSigner;
        perPaymentCap = initialPerPaymentCap;
        approvalThreshold = initialApprovalThreshold;
        policyVersion = 1;
        witnessVersion = 1;
        rulesVersion = 1;
        emit WitnessSignerSet(initialWitnessSigner);
        emit PolicySet(1, initialPerPaymentCap, initialApprovalThreshold);
    }

    function release(
        WitnessAttestation calldata attestation,
        bytes calldata witnessSignature,
        bytes calldata ownerApproval
    ) external whenNotPaused nonReentrant {
        if (settled[attestation.obligationId]) {
            revert ObligationAlreadySettled(attestation.obligationId);
        }
        if (usedOperations[attestation.operationId]) revert OperationAlreadyUsed(attestation.operationId);
        if (attestation.validUntil < block.timestamp) revert AttestationExpired(attestation.validUntil);
        if (attestation.chainId != block.chainid) revert ChainIdMismatch(attestation.chainId, block.chainid);
        if (attestation.verifyingContract != address(this)) {
            revert VerifyingContractMismatch(attestation.verifyingContract, address(this));
        }
        if (attestation.policyVersion != policyVersion) {
            revert StalePolicyVersion(attestation.policyVersion, policyVersion);
        }
        Vendor memory vendor = vendors[attestation.vendorIdHash];
        if (!vendor.active) revert VendorInactive(attestation.vendorIdHash);
        if (attestation.vendorVersion != vendor.version) {
            revert StaleVendorVersion(attestation.vendorVersion, vendor.version);
        }
        if (attestation.witnessVersion != witnessVersion) {
            revert StaleWitnessVersion(attestation.witnessVersion, witnessVersion);
        }
        if (attestation.rulesVersion != rulesVersion) {
            revert StaleRulesVersion(attestation.rulesVersion, rulesVersion);
        }
        if (attestation.payee != vendor.payout) revert PayeeMismatch(attestation.payee, vendor.payout);
        if (attestation.token != address(settlementToken)) {
            revert TokenMismatch(attestation.token, address(settlementToken));
        }
        if (attestation.amount == 0) revert InvalidAmount();
        if (attestation.amount > perPaymentCap) {
            revert PaymentCapExceeded(attestation.amount, perPaymentCap);
        }
        if (
            attestation.obligationId == bytes32(0) || attestation.operationId == bytes32(0)
                || attestation.businessIdHash == bytes32(0) || attestation.vendorIdHash == bytes32(0)
                || attestation.evidenceRoot == bytes32(0) || attestation.receiptHash == bytes32(0)
        ) revert InvalidCommitment();

        bytes32 digest = hashAttestation(attestation);
        if (ECDSA.recover(digest, witnessSignature) != witnessSigner) revert InvalidWitnessSignature();
        if (attestation.amount > approvalThreshold) _verifyOwnerApproval(digest, ownerApproval);

        // Effects precede the external token call. This business-semantic key is
        // deliberately independent of API request IDs or worker retry IDs.
        settled[attestation.obligationId] = true;
        usedOperations[attestation.operationId] = true;
        settlementToken.safeTransfer(attestation.payee, attestation.amount);
        emit ObligationSettled(
            attestation.obligationId,
            attestation.vendorIdHash,
            attestation.payee,
            attestation.amount,
            attestation.evidenceRoot,
            attestation.receiptHash
        );
    }

    function hashAttestation(WitnessAttestation calldata attestation) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                WITNESS_ATTESTATION_TYPEHASH,
                attestation.obligationId,
                attestation.operationId,
                attestation.businessIdHash,
                attestation.vendorIdHash,
                attestation.payee,
                attestation.token,
                attestation.amount,
                attestation.evidenceRoot,
                attestation.receiptHash,
                attestation.vendorVersion,
                attestation.policyVersion,
                attestation.witnessVersion,
                attestation.rulesVersion,
                attestation.validUntil,
                attestation.chainId,
                attestation.verifyingContract
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function hashOwnerApproval(bytes32 attestationHash, uint64 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(OWNER_APPROVAL_TYPEHASH, attestationHash, deadline)));
    }

    function setVendor(bytes32 vendorIdHash, address payout) external onlyOwner {
        if (vendorIdHash == bytes32(0) || payout == address(0)) revert ZeroAddress();
        uint64 nextVersion = vendors[vendorIdHash].version + 1;
        vendors[vendorIdHash] = Vendor({payout: payout, version: nextVersion, active: true});
        emit VendorSet(vendorIdHash, payout, nextVersion);
    }

    function deactivateVendor(bytes32 vendorIdHash) external onlyOwner {
        Vendor storage vendor = vendors[vendorIdHash];
        if (!vendor.active) revert VendorInactive(vendorIdHash);
        vendor.active = false;
        vendor.version += 1;
        emit VendorDeactivated(vendorIdHash, vendor.version);
    }

    function setWitnessSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        witnessSigner = signer;
        witnessVersion += 1;
        emit WitnessSignerSet(signer);
    }

    function setRulesVersion(uint64 newVersion) external onlyOwner {
        if (newVersion <= rulesVersion) revert InvalidAmount();
        rulesVersion = newVersion;
        emit RulesVersionSet(newVersion);
    }

    function setPolicy(uint256 newPerPaymentCap, uint256 newApprovalThreshold) external onlyOwner {
        if (newPerPaymentCap == 0 || newApprovalThreshold > newPerPaymentCap) revert InvalidAmount();
        perPaymentCap = newPerPaymentCap;
        approvalThreshold = newApprovalThreshold;
        policyVersion += 1;
        emit PolicySet(policyVersion, newPerPaymentCap, newApprovalThreshold);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _verifyOwnerApproval(bytes32 attestationHash, bytes calldata encodedApproval) private view {
        if (encodedApproval.length == 0) revert OwnerApprovalRequired();
        (uint64 deadline, bytes memory signature) = abi.decode(encodedApproval, (uint64, bytes));
        if (deadline < block.timestamp) revert OwnerApprovalExpired(deadline);
        if (ECDSA.recover(hashOwnerApproval(attestationHash, deadline), signature) != owner()) {
            revert InvalidOwnerApproval();
        }
    }
}
