// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ObligationVault} from "../src/ObligationVault.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {TestBase} from "./TestBase.sol";

contract ObligationVaultTest is TestBase {
    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant WITNESS_KEY = 0xB0B;
    uint256 private constant OTHER_KEY = 0xBAD;
    uint256 private constant CAP = 1_000_000_000;
    uint256 private constant APPROVAL_THRESHOLD = 500_000_000;
    bytes32 private constant VENDOR_ID = keccak256("vendor_acme");

    address private owner;
    address private witness;
    address private payee;
    MockUSDC private usdc;
    ObligationVault private vault;

    function setUp() public {
        vm.warp(1_800_000_000);
        owner = vm.addr(OWNER_KEY);
        witness = vm.addr(WITNESS_KEY);
        payee = vm.addr(0xCAFE);
        usdc = new MockUSDC();
        vault = new ObligationVault(owner, witness, usdc, CAP, APPROVAL_THRESHOLD);
        vm.prank(owner);
        vault.setVendor(VENDOR_ID, payee);
        usdc.mint(address(vault), 10_000_000_000);
    }

    function testReleaseBindsAndSettlesExactObligation() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        vault.release(attestation, _signWitness(attestation), "");
        assertEq(usdc.balanceOf(payee), 125_000_000);
        assertTrue(vault.settled(attestation.obligationId));
    }

    function testReplayAlwaysReverts() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        vault.release(attestation, signature, "");
        vm.expectPartialRevert(ObligationVault.ObligationAlreadySettled.selector);
        vault.release(attestation, signature, "");
    }

    function testVendorChangeInvalidatesOldAttestation() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        vm.prank(owner);
        vault.setVendor(VENDOR_ID, vm.addr(0xD00D));
        vm.expectPartialRevert(ObligationVault.StaleVendorVersion.selector);
        vault.release(attestation, signature, "");
    }

    function testPolicyChangeInvalidatesOldAttestation() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        vm.prank(owner);
        vault.setPolicy(CAP, APPROVAL_THRESHOLD);
        vm.expectPartialRevert(ObligationVault.StalePolicyVersion.selector);
        vault.release(attestation, signature, "");
    }

    function testWrongPayeeRevertsEvenWithWitnessSignature() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        attestation.payee = vm.addr(OTHER_KEY);
        bytes memory signature = _signWitness(attestation);
        vm.expectPartialRevert(ObligationVault.PayeeMismatch.selector);
        vault.release(attestation, signature, "");
    }

    function testChangedAmountAfterSigningInvalidatesSignature() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        attestation.amount = 125_000_001;
        vm.expectRevert();
        vault.release(attestation, signature, "");
    }

    function testChangedEvidenceRootAfterSigningInvalidatesSignature() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        attestation.evidenceRoot = keccak256("altered_evidence");
        vm.expectRevert();
        vault.release(attestation, signature, "");
    }

    function testCrossVaultReplayFails() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        ObligationVault otherVault = new ObligationVault(owner, witness, usdc, CAP, APPROVAL_THRESHOLD);
        vm.prank(owner);
        otherVault.setVendor(VENDOR_ID, payee);
        usdc.mint(address(otherVault), 1_000_000_000);
        vm.expectPartialRevert(ObligationVault.VerifyingContractMismatch.selector);
        otherVault.release(attestation, signature, "");
    }

    function testCrossChainReplayFails() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        vm.chainId(block.chainid + 1);
        vm.expectPartialRevert(ObligationVault.ChainIdMismatch.selector);
        vault.release(attestation, signature, "");
    }

    function testStaleWitnessVersionFails() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        vm.prank(owner);
        vault.setWitnessSigner(vm.addr(0xC0DE));
        vm.expectPartialRevert(ObligationVault.StaleWitnessVersion.selector);
        vault.release(attestation, signature, "");
    }

    function testOperationIdCannotBeReused() public {
        ObligationVault.WitnessAttestation memory first = _attestation(100_000_000);
        vault.release(first, _signWitness(first), "");
        ObligationVault.WitnessAttestation memory second = _attestation(100_000_000);
        second.obligationId = keccak256("different_obligation");
        bytes memory signature = _signWitness(second);
        vm.expectPartialRevert(ObligationVault.OperationAlreadyUsed.selector);
        vault.release(second, signature, "");
    }

    function testExpiredAttestationReverts() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        attestation.validUntil = uint64(block.timestamp - 1);
        bytes memory signature = _signWitness(attestation);
        vm.expectPartialRevert(ObligationVault.AttestationExpired.selector);
        vault.release(attestation, signature, "");
    }

    function testPausedVaultNeverReleases() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(125_000_000);
        bytes memory signature = _signWitness(attestation);
        vm.prank(owner);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.release(attestation, signature, "");
    }

    function testPaymentCapIsHardBoundary() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(CAP + 1);
        bytes memory signature = _signWitness(attestation);
        vm.expectPartialRevert(ObligationVault.PaymentCapExceeded.selector);
        vault.release(attestation, signature, "");
    }

    function testApprovalAboveThresholdBindsExactAttestation() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(600_000_000);
        bytes32 attestationHash = vault.hashAttestation(attestation);
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory approval =
            abi.encode(deadline, _sign(OWNER_KEY, vault.hashOwnerApproval(attestationHash, deadline)));
        vault.release(attestation, _signWitness(attestation), approval);
        assertEq(usdc.balanceOf(payee), 600_000_000);
    }

    function testAboveThresholdWithoutApprovalFailsClosed() public {
        ObligationVault.WitnessAttestation memory attestation = _attestation(600_000_000);
        bytes memory signature = _signWitness(attestation);
        vm.expectRevert(ObligationVault.OwnerApprovalRequired.selector);
        vault.release(attestation, signature, "");
    }

    function testFuzzObligationCanSettleAtMostOnce(uint256 rawAmount, bytes32 rawId) public {
        uint256 amount = bound(rawAmount, 1, APPROVAL_THRESHOLD);
        ObligationVault.WitnessAttestation memory attestation = _attestation(amount);
        attestation.obligationId = rawId == bytes32(0) ? keccak256("fallback") : rawId;
        bytes memory signature = _signWitness(attestation);
        vault.release(attestation, signature, "");
        assertEq(usdc.balanceOf(payee), amount);
        vm.expectPartialRevert(ObligationVault.ObligationAlreadySettled.selector);
        vault.release(attestation, signature, "");
    }

    function _attestation(uint256 amount) private view returns (ObligationVault.WitnessAttestation memory) {
        return ObligationVault.WitnessAttestation({
            obligationId: keccak256("obl_1042"),
            operationId: keccak256("op_1042_release_1"),
            businessIdHash: keccak256("biz_demo"),
            vendorIdHash: VENDOR_ID,
            payee: payee,
            token: address(usdc),
            amount: amount,
            evidenceRoot: keccak256("evidence_root"),
            receiptHash: keccak256("receipt_hash"),
            vendorVersion: 1,
            policyVersion: 1,
            witnessVersion: 1,
            rulesVersion: 1,
            validUntil: uint64(block.timestamp + 10 minutes),
            chainId: block.chainid,
            verifyingContract: address(vault)
        });
    }

    function _signWitness(ObligationVault.WitnessAttestation memory attestation) private returns (bytes memory) {
        return _sign(WITNESS_KEY, vault.hashAttestation(attestation));
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
