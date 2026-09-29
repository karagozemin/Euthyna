// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ObligationVault} from "../src/ObligationVault.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata name) external returns (address);
    function envBytes32(string calldata name) external returns (bytes32);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployObligationVault {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ObligationVault vault) {
        uint256 deployerKey = vm.envUint("ARC_DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("VAULT_OWNER_ADDRESS");
        address witnessSigner = vm.envAddress("WITNESS_SIGNER_ADDRESS");
        bytes32 businessIdHash = vm.envBytes32("VAULT_BUSINESS_ID_HASH");
        IERC20 usdc = IERC20(vm.envAddress("ARC_USDC_ADDRESS"));
        uint256 cap = vm.envUint("VAULT_PER_PAYMENT_CAP_MINOR");
        uint256 approvalThreshold = vm.envUint("VAULT_APPROVAL_THRESHOLD_MINOR");
        uint256 initialFunding = vm.envUint("VAULT_INITIAL_FUNDING_MINOR");
        bytes32 testVendorIdHash = vm.envBytes32("TEST_VENDOR_ID_HASH");
        address testVendorPayee = vm.envAddress("TEST_VENDOR_PAYEE_ADDRESS");

        require(vm.addr(deployerKey) == owner, "deployer must be initial owner for test setup");
        vm.startBroadcast(deployerKey);
        vault = new ObligationVault(owner, witnessSigner, businessIdHash, usdc, cap, approvalThreshold);
        vault.setVendor(testVendorIdHash, testVendorPayee);
        require(usdc.transfer(address(vault), initialFunding), "initial vault funding failed");
        vm.stopBroadcast();
    }
}
