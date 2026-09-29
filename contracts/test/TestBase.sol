// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function expectPartialRevert(bytes4 revertData) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 left, uint256 right) internal pure {
        require(left == right, "assertEq(uint256) failed");
    }

    function assertEq(address left, address right) internal pure {
        require(left == right, "assertEq(address) failed");
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        require(left == right, "assertEq(bytes32) failed");
    }

    function assertTrue(bool value) internal pure {
        require(value, "assertTrue failed");
    }

    function bound(uint256 value, uint256 minimum, uint256 maximum) internal pure returns (uint256) {
        if (minimum == maximum) return minimum;
        return minimum + (value % (maximum - minimum + 1));
    }
}
