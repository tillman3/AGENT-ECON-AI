// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AgentIdentity8004.sol";
import "../src/ReputationRegistry8004.sol";

contract ERC8004Test is Test {
    AgentIdentity8004 public identity;
    ReputationRegistry8004 public reputation;

    address public owner = address(0x1);
    address public alice = address(0xA);
    address public bob = address(0xB);
    address public validatorPool = address(0xBB);

    function setUp() public {
        vm.startPrank(owner);
        identity = new AgentIdentity8004(owner);
        reputation = new ReputationRegistry8004(owner, address(identity));
        reputation.setAuthorizedSource(validatorPool, true);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════
    //  Identity Registry
    // ═══════════════════════════════════════════

    function test_registerWithURI() public {
        vm.prank(alice);
        uint256 agentId = identity.register("ipfs://QmTest123");

        assertEq(identity.ownerOf(agentId), alice);
        assertEq(identity.tokenURI(agentId), "ipfs://QmTest123");
        assertEq(identity.totalAgents(), 1);
        assertEq(identity.getAgentWallet(agentId), alice);
    }

    function test_registerWithMetadata() public {
        AgentIdentity8004.MetadataEntry[] memory meta = new AgentIdentity8004.MetadataEntry[](2);
        meta[0] = AgentIdentity8004.MetadataEntry("name", abi.encodePacked("TestAgent"));
        meta[1] = AgentIdentity8004.MetadataEntry("version", abi.encodePacked("1.0"));

        vm.prank(alice);
        uint256 agentId = identity.register("https://agent.test/card.json", meta);

        assertEq(identity.ownerOf(agentId), alice);
        assertEq(identity.getMetadata(agentId, "name"), abi.encodePacked("TestAgent"));
        assertEq(identity.getMetadata(agentId, "version"), abi.encodePacked("1.0"));
    }

    function test_registerNoURI() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        assertEq(identity.ownerOf(agentId), alice);
        assertEq(identity.totalAgents(), 1);
    }

    function test_updateAgentURI() public {
        vm.prank(alice);
        uint256 agentId = identity.register("ipfs://old");

        vm.prank(alice);
        identity.setAgentURI(agentId, "ipfs://new");

        assertEq(identity.tokenURI(agentId), "ipfs://new");
    }

    function test_setMetadata() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        vm.prank(alice);
        identity.setMetadata(agentId, "endpoint", abi.encodePacked("https://api.test"));

        assertEq(identity.getMetadata(agentId, "endpoint"), abi.encodePacked("https://api.test"));
    }

    function test_cannotSetReservedKey() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        vm.prank(alice);
        vm.expectRevert(AgentIdentity8004.ReservedMetadataKey.selector);
        identity.setMetadata(agentId, "agentWallet", abi.encodePacked(bob));
    }

    function test_walletClearedOnTransfer() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        assertEq(identity.getAgentWallet(agentId), alice);

        vm.prank(alice);
        identity.transferFrom(alice, bob, agentId);

        // Wallet should be cleared
        assertEq(identity.getAgentWallet(agentId), address(0));
        assertEq(identity.ownerOf(agentId), bob);
    }

    function test_incrementalIds() public {
        vm.prank(alice);
        uint256 id1 = identity.register();
        vm.prank(bob);
        uint256 id2 = identity.register();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(identity.totalAgents(), 2);
    }

    function test_onlyOwnerCanSetMetadata() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        vm.prank(bob);
        vm.expectRevert(AgentIdentity8004.NotAgentOwnerOrApproved.selector);
        identity.setMetadata(agentId, "test", abi.encodePacked("data"));
    }

    // ═══════════════════════════════════════════
    //  Reputation Registry
    // ═══════════════════════════════════════════

    function test_giveFeedback() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: 85,
            valueDecimals: 0,
            tag1: "starred",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(bob);
        reputation.giveFeedback(input);

        assertEq(reputation.feedbackCount(agentId, bob), 1);
        assertEq(reputation.totalFeedbackCount(agentId), 1);

        (int256 score, uint256 count) = reputation.getAggregateScore(agentId);
        assertEq(score, 85);
        assertEq(count, 1);
    }

    function test_cannotFeedbackOwnAgent() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: 100,
            valueDecimals: 0,
            tag1: "",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(alice); // same as owner
        vm.expectRevert(ReputationRegistry8004.CannotFeedbackOwnAgent.selector);
        reputation.giveFeedback(input);
    }

    function test_authorizedFeedback() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        // ValidatorPool can submit feedback on behalf of clients
        vm.prank(validatorPool);
        reputation.giveFeedbackFrom(agentId, bob, 90, 0, "validation", "passed");

        assertEq(reputation.feedbackCount(agentId, bob), 1);
        (int256 score,) = reputation.getAggregateScore(agentId);
        assertEq(score, 90);
    }

    function test_revokeFeedback() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: 75,
            valueDecimals: 0,
            tag1: "",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(bob);
        reputation.giveFeedback(input);

        (int256 scoreBefore,) = reputation.getAggregateScore(agentId);
        assertEq(scoreBefore, 75);

        vm.prank(bob);
        reputation.revokeFeedback(agentId, 1);

        (int256 scoreAfter, uint256 count) = reputation.getAggregateScore(agentId);
        assertEq(scoreAfter, 0);
        assertEq(count, 0);
    }

    function test_averageScore() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        address carol = address(0xC);
        address dave = address(0xD);

        // Three feedbacks: 80, 90, 100
        ReputationRegistry8004.FeedbackInput memory input;
        input.agentId = agentId;
        input.valueDecimals = 0;

        input.value = 80;
        vm.prank(bob);
        reputation.giveFeedback(input);

        input.value = 90;
        vm.prank(carol);
        reputation.giveFeedback(input);

        input.value = 100;
        vm.prank(dave);
        reputation.giveFeedback(input);

        // Average = (80+90+100)/3 = 90, scaled by 100 = 9000
        assertEq(reputation.getAverageScore(agentId), 9000);
    }

    function test_negativeFeedback() public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: -50,
            valueDecimals: 0,
            tag1: "tradingYield",
            tag2: "month",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(bob);
        reputation.giveFeedback(input);

        (int256 score,) = reputation.getAggregateScore(agentId);
        assertEq(score, -50);
    }

    // ═══════════════════════════════════════════
    //  Fuzz
    // ═══════════════════════════════════════════

    function testFuzz_feedbackValue(int128 value) public {
        vm.prank(alice);
        uint256 agentId = identity.register();

        ReputationRegistry8004.FeedbackInput memory input = ReputationRegistry8004.FeedbackInput({
            agentId: agentId,
            value: value,
            valueDecimals: 0,
            tag1: "",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });

        vm.prank(bob);
        reputation.giveFeedback(input);

        (int256 score,) = reputation.getAggregateScore(agentId);
        assertEq(score, int256(value));
    }
}
