#!/usr/bin/env node
/**
 * AgentEcon On-Chain Activity Monitor
 * Checks for new agents, tasks, completions, and unknown wallets
 * Run via cron every 30 min
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "fs";

const RPC = "https://base-rpc.publicnode.com";
const provider = new ethers.JsonRpcProvider(RPC);

const CONTRACTS = {
  ABBCoreV2:       "0x8Bac098243c8AEe9E2d338456b4d2860875084dB",
  TaskRegistry:    "0xc78866b33Ff6Eb5b58281e77fB2666611505C465",
  AgentRegistry:   "0x03f62E221cCf126281AF321D1f9e8fb95b6Fe572",
  BountyEscrow:    "0x595dBdD8071c6893a31abD500Ca66EA0E0d0e0Fc",
  ValidatorPoolV2: "0x22bbEc2a7DD9959dFD31144317F185500d993C8b",
  AECONToken:      "0x40510af7D63316a267a5302A382e829dAd40bcf5",
};

// Known demo wallets
const KNOWN_WALLETS = new Set([
  "0xaa37c76d701b123d1d3bdd57a39ee50404c1e642", // Boss/owner
  "0xef41af8b9c22e572df6d7006617e0820966e36f8", // Old deployer (burned)
  "0x6265dbbe3f6785a68f3db41712d4c7586df9eca4", // CodeBot-α
  "0x2ee33893bba1e4bc85b7feece61bdf9d33bd3829", // ResearchAgent-1
  "0xfc318bf903f70136a72b40abba1ba511039ff6ec", // DataCruncher
  "0xf19385dbb6165da33f5f31bb0b06004914d37911", // AuditBot
  "0xfca35ced15e3b3e2efe66548f8ff4d0222504ab0", // ContentForge
]);

const STATE_FILE = "/home/tars/.openclaw/workspace/agent-bounty-board/scripts/.monitor-state.json";

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  return { lastBlock: 0, totalTasks: 0, totalAgents: 0, totalCompleted: 0, unknownWallets: [] };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const state = loadState();
  const currentBlock = await provider.getBlockNumber();
  const alerts = [];
  
  // Check task count
  const taskReg = new ethers.Contract(CONTRACTS.TaskRegistry, [
    "function nextTaskId() view returns (uint256)",
    "function getTask(uint256) view returns (tuple(uint256 id, address poster, bytes32 descriptionHash, uint256 bountyAmount, address paymentToken, uint64 deadline, uint8 state, uint256 assignedAgent, bytes32 submissionHash, uint64 createdAt, uint64 claimedAt, uint64 submittedAt))",
  ], provider);
  
  const agentReg = new ethers.Contract(CONTRACTS.AgentRegistry, [
    "function nextAgentId() view returns (uint256)",
  ], provider);
  
  const token = new ethers.Contract(CONTRACTS.AECONToken, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);
  
  const escrow = new ethers.Contract(CONTRACTS.BountyEscrow, [
    "function ethPayable(address) view returns (uint256)",
  ], provider);
  
  const nextTaskId = Number(await taskReg.nextTaskId());
  const nextAgentId = Number(await agentReg.nextAgentId());
  
  // Count completed tasks
  let completed = 0;
  const states = ["Open", "Claimed", "Submitted", "InReview", "Completed", "Expired", "Rejected"];
  const stateCounts = {};
  
  for (let i = 0; i < nextTaskId; i++) {
    await new Promise(r => setTimeout(r, 200));
    const t = await taskReg.getTask(i);
    const s = states[Number(t.state)];
    stateCounts[s] = (stateCounts[s] || 0) + 1;
    if (Number(t.state) === 4) completed++;
    
    // Check for unknown wallets
    const poster = t.poster.toLowerCase();
    if (!KNOWN_WALLETS.has(poster) && !state.unknownWallets.includes(poster)) {
      alerts.push(`🆕 NEW EXTERNAL USER detected! Wallet: ${t.poster} (posted task ${i})`);
      state.unknownWallets.push(poster);
    }
  }
  
  // Check for new activity since last run
  if (state.totalTasks > 0 && nextTaskId > state.totalTasks) {
    alerts.push(`📋 ${nextTaskId - state.totalTasks} new task(s) created (total: ${nextTaskId})`);
  }
  if (state.totalAgents > 0 && nextAgentId > state.totalAgents) {
    alerts.push(`🤖 ${nextAgentId - state.totalAgents} new agent(s) registered (total: ${nextAgentId})`);
  }
  if (state.totalCompleted > 0 && completed > state.totalCompleted) {
    alerts.push(`✅ ${completed - state.totalCompleted} task(s) completed (total: ${completed})`);
  }
  
  // Check fee balance
  const feeBalance = await escrow.ethPayable("0xaa37c76d701b123d1d3bdd57a39ee50404c1e642");
  
  // Summary
  const summary = {
    block: currentBlock,
    tasks: nextTaskId,
    agents: nextAgentId,
    completed,
    stateCounts,
    feeBalanceETH: ethers.formatEther(feeBalance),
    alerts: alerts.length,
  };
  
  console.log(JSON.stringify(summary, null, 2));
  
  if (alerts.length > 0) {
    console.log("\n⚠️ ALERTS:");
    alerts.forEach(a => console.log(a));
  }
  
  // Update state
  state.lastBlock = currentBlock;
  state.totalTasks = nextTaskId;
  state.totalAgents = nextAgentId;
  state.totalCompleted = completed;
  saveState(state);
}

main().catch(e => { console.error("Monitor error:", e.message); process.exit(1); });
