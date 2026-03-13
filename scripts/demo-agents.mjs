#!/usr/bin/env node
/**
 * AgentEcon Demo Agent Orchestrator v2
 * 
 * Runs the full task lifecycle on Base mainnet:
 * 1. Create tasks with ETH bounties (escrowed)
 * 2. Agents claim tasks cross-agent (agent A posts, agent B claims)
 * 3. Agents submit work hashes
 * 
 * Note: Validation requires 0.1 ETH validator stake per validator.
 * Until funded, tasks will be created/claimed/submitted but not validated.
 * 
 * Usage: node scripts/demo-agents.mjs [--create] [--claim] [--submit] [--all]
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PROVIDER = new ethers.JsonRpcProvider('https://base-rpc.publicnode.com');

// Contract addresses (Base mainnet)
const ADDR = {
  abbCore:     '0x8Bac098243c8AEe9E2d338456b4d2860875084dB',
  agentReg:    '0x03f62E221cCf126281AF321D1f9e8fb95b6Fe572',
  taskReg:     '0xc78866b33Ff6Eb5b58281e77fB2666611505C465',
  escrow:      '0x595dBdD8071c6893a31abD500Ca66EA0E0d0e0Fc',
  validatorV2: '0x22bbEc2a7DD9959dFD31144317F185500d993C8b',
};

// Minimal ABIs
const ABI = {
  abbCore: [
    'function createTaskETH(bytes32 descriptionHash, uint64 deadline) external payable returns (uint256)',
    'function claimTask(uint256 taskId, uint256 agentId) external',
    'function submitWork(uint256 taskId, bytes32 submissionHash) external',
    'function finalizeReview(uint256 taskId) external',
  ],
  agentReg: [
    'function registerAgent(bytes32 metadataHash) external returns (uint256)',
    'function getAgentId(address) external view returns (uint256)',
    'function getOperatorAgents(address) external view returns (uint256[])',
    'function nextAgentId() external view returns (uint256)',
  ],
  taskReg: [
    'function getTask(uint256 taskId) external view returns (tuple(uint256 id, address poster, bytes32 descriptionHash, uint256 bountyAmount, address paymentToken, uint64 deadline, uint8 state, uint256 assignedAgent, bytes32 submissionHash, uint64 createdAt, uint64 claimedAt, uint64 submittedAt))',
    'function nextTaskId() external view returns (uint256)',
  ],
  validatorV2: [
    'function aiValidatorCount() external view returns (uint256)',
    'function activeValidatorCount() external view returns (uint256)',
    'function registerValidator(bool isAI) external payable',
  ],
};

// Agent personas
const PERSONAS = [
  { name: 'CodeBot-α',        specialty: 'code-review' },
  { name: 'ResearchAgent-1',  specialty: 'research' },
  { name: 'DataCruncher',     specialty: 'data-analysis' },
  { name: 'AuditBot',         specialty: 'security-audit' },
  { name: 'ContentForge',     specialty: 'technical-writing' },
];

// Task templates — each agent creates tasks in their domain, others claim them
const TASKS = [
  { desc: 'Review ERC-4337 account abstraction implementation for gas optimizations', bountyEth: '0.0002' },
  { desc: 'Research report: comparing rollup architectures — Optimistic vs ZK in 2026', bountyEth: '0.0002' },
  { desc: 'Analyze Base L2 transaction patterns and create summary statistics', bountyEth: '0.0002' },
  { desc: 'Security review of ERC-8004 reference implementation', bountyEth: '0.0003' },
  { desc: 'Write developer quickstart guide for AgentEcon Python SDK', bountyEth: '0.0002' },
  { desc: 'Benchmark Solidity compiler optimization: 200 vs 10000 runs', bountyEth: '0.0002' },
  { desc: 'Summarize top 5 AI agent frameworks by GitHub activity', bountyEth: '0.0002' },
  { desc: 'Create data pipeline spec for on-chain reputation aggregation', bountyEth: '0.0002' },
];

// Work result templates
const WORK_RESULTS = [
  'Found 3 gas optimizations in calldata encoding, saving ~15% on UserOp validation. Detailed diff attached.',
  'Comprehensive 12-page comparison. ZK rollups now achieve 95% cost reduction vs mainnet. Key finding: hybrid approaches emerging.',
  'Analyzed 2.4M transactions. Average gas: 42,000. Peak hours: 14-18 UTC. DeFi dominates at 61%.',
  'No critical vulnerabilities found. 2 low-severity issues: missing event emission on wallet change, unchecked return value.',
  'Published 2,000-word guide covering install, register, create-task, claim, submit. Code samples tested on Base Sepolia.',
  'Results: 200 runs = 24,576 bytes, 10K runs = 22,891 bytes. Runtime difference: <0.5%. 200 runs recommended for most contracts.',
  'Ranked: 1. LangChain (48K stars), 2. CrewAI (22K), 3. AutoGPT (19K), 4. ElizaOS (15K), 5. MetaGPT (12K).',
  'Designed 3-layer pipeline: indexer → aggregator → scorer. Estimated 500ms p99 latency for reputation queries.',
];

function loadAgents() {
  const envPath = resolve(ROOT, '.env.agents');
  const lines = readFileSync(envPath, 'utf-8').split('\n').filter(l => l && !l.startsWith('#'));
  const agents = [];
  
  for (let i = 1; i <= 5; i++) {
    const addr = lines.find(l => l.startsWith(`AGENT${i}_ADDRESS=`))?.split('=')[1];
    const key = lines.find(l => l.startsWith(`AGENT${i}_KEY=`))?.split('=')[1];
    if (addr && key) {
      const wallet = new ethers.Wallet(key, PROVIDER);
      agents.push({ id: i, address: addr, key, wallet, persona: PERSONAS[i - 1] });
    }
  }
  return agents;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Rate-limited RPC call wrapper
async function rpcCall(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await sleep(500); // Throttle all RPC calls
      return await fn();
    } catch (e) {
      if (i < retries - 1 && (e.code === 'SERVER_ERROR' || e.message?.includes('rate limit'))) {
        console.log(`  ⏳ Rate limited, waiting ${(i + 1) * 3}s...`);
        await sleep((i + 1) * 3000);
      } else throw e;
    }
  }
}

async function sendTx(label, txPromise) {
  try {
    const tx = await txPromise;
    const receipt = await tx.wait();
    const gas = receipt.gasUsed;
    console.log(`  ✅ ${label} | tx: ${tx.hash.slice(0, 18)}... | gas: ${gas}`);
    return receipt;
  } catch (e) {
    const msg = e.message?.slice(0, 120) || String(e);
    console.log(`  ❌ ${label} | ${msg}`);
    return null;
  }
}

async function showBalances(agents) {
  console.log('\n📊 Agent Balances:');
  for (const a of agents) {
    const bal = await PROVIDER.getBalance(a.address);
    console.log(`  ${a.persona.name.padEnd(18)} ${ethers.formatEther(bal).slice(0, 12)} ETH`);
  }
}

async function ensureRegistered(agents) {
  console.log('\n📝 Checking Agent Registration:');
  const reg = new ethers.Contract(ADDR.agentReg, ABI.agentReg, PROVIDER);
  
  for (const a of agents) {
    let agentIds = [];
    try { agentIds = await reg.getOperatorAgents(a.address); } catch {}
    if (agentIds.length > 0) {
      a.agentId = Number(agentIds[0]);
      console.log(`  ✅ ${a.persona.name} registered (ID: ${a.agentId})`);
    } else {
      const regContract = new ethers.Contract(ADDR.agentReg, ABI.agentReg, a.wallet);
      const metaHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(a.persona)));
      const receipt = await sendTx(`Register ${a.persona.name}`, regContract.registerAgent(metaHash));
      if (receipt) {
        try {
          const agentIds = await reg.getOperatorAgents(a.address);
          if (agentIds.length > 0) {
            a.agentId = Number(agentIds[agentIds.length - 1]);
            console.log(`     → Agent ID: ${a.agentId}`);
          }
        } catch { /* fallback: use nextAgentId - 1 */ }
      }
    }
  }
}

async function createTasks(agents) {
  console.log('\n📋 Creating Tasks:');
  const taskReg = new ethers.Contract(ADDR.taskReg, ABI.taskReg, PROVIDER);
  const nextId = Number(await taskReg.nextTaskId());
  console.log(`  Current task count: ${nextId}`);
  
  // Each agent creates 1-2 tasks
  const created = [];
  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    const agent = agents[i % agents.length];
    const core = new ethers.Contract(ADDR.abbCore, ABI.abbCore, agent.wallet);
    
    const descHash = ethers.keccak256(ethers.toUtf8Bytes(task.desc));
    const deadline = Math.floor(Date.now() / 1000) + (7 * 86400); // 7 days
    
    const receipt = await sendTx(
      `"${task.desc.slice(0, 50)}..." by ${agent.persona.name} (${task.bountyEth} ETH)`,
      core.createTaskETH(descHash, deadline, { value: ethers.parseEther(task.bountyEth) })
    );
    
    if (receipt) {
      created.push({ taskId: nextId + created.length, creator: agent, task });
    }
    
    await sleep(2000); // Don't spam
  }
  
  return created;
}

async function claimTasks(agents) {
  console.log('\n🎯 Claiming Tasks:');
  const taskReg = new ethers.Contract(ADDR.taskReg, ABI.taskReg, PROVIDER);
  const nextId = Number(await taskReg.nextTaskId());
  
  const claimed = [];
  for (let taskId = 0; taskId < nextId; taskId++) {
    const task = await taskReg.getTask(taskId);
    // state 0 = Open
    if (Number(task.state) !== 0) continue;
    
    // Pick an agent that didn't create this task
    const creator = task.poster.toLowerCase();
    const claimer = agents.find(a => a.address.toLowerCase() !== creator && a.agentId);
    if (!claimer) continue;
    
    const core = new ethers.Contract(ADDR.abbCore, ABI.abbCore, claimer.wallet);
    const receipt = await sendTx(
      `Task #${taskId} claimed by ${claimer.persona.name} (agentId: ${claimer.agentId})`,
      core.claimTask(taskId, claimer.agentId)
    );
    
    if (receipt) claimed.push({ taskId, claimer });
    await sleep(2000);
    
    if (claimed.length >= 4) break; // Don't claim everything at once
  }
  
  return claimed;
}

async function submitWork(agents) {
  console.log('\n📤 Submitting Work:');
  const taskReg = new ethers.Contract(ADDR.taskReg, ABI.taskReg, PROVIDER);
  const nextId = Number(await taskReg.nextTaskId());
  
  const submitted = [];
  for (let taskId = 0; taskId < nextId; taskId++) {
    const task = await taskReg.getTask(taskId);
    // state 1 = Claimed
    if (Number(task.state) !== 1) continue;
    
    // Find the agent assigned to this task
    const assignedId = Number(task.assignedAgent);
    const agent = agents.find(a => a.agentId === assignedId);
    if (!agent) continue;
    
    const workResult = WORK_RESULTS[taskId % WORK_RESULTS.length];
    const workHash = ethers.keccak256(ethers.toUtf8Bytes(workResult));
    
    const core = new ethers.Contract(ADDR.abbCore, ABI.abbCore, agent.wallet);
    const receipt = await sendTx(
      `Task #${taskId} work submitted by ${agent.persona.name}`,
      core.submitWork(taskId, workHash)
    );
    
    if (receipt) submitted.push({ taskId, agent });
    await sleep(2000);
  }
  
  return submitted;
}

async function showStatus() {
  console.log('\n📊 Protocol Status:');
  const taskReg = new ethers.Contract(ADDR.taskReg, ABI.taskReg, PROVIDER);
  const agentReg = new ethers.Contract(ADDR.agentReg, ABI.agentReg, PROVIDER);
  const valPool = new ethers.Contract(ADDR.validatorV2, ABI.validatorV2, PROVIDER);
  
  const nextTask = Number(await taskReg.nextTaskId());
  const nextAgent = Number(await agentReg.nextAgentId());
  const aiVals = Number(await valPool.aiValidatorCount());
  const activeVals = Number(await valPool.activeValidatorCount());
  
  let states = { open: 0, claimed: 0, submitted: 0, inReview: 0, completed: 0, expired: 0 };
  for (let i = 0; i < nextTask; i++) {
    const task = await taskReg.getTask(i);
    const s = Number(task.state);
    if (s === 0) states.open++;
    else if (s === 1) states.claimed++;
    else if (s === 2) states.submitted++;
    else if (s === 3) states.inReview++;
    else if (s === 4) states.completed++;
    else if (s === 5) states.expired++;
  }
  
  console.log(`  Tasks:      ${nextTask} total (${states.open} open, ${states.claimed} claimed, ${states.submitted} submitted, ${states.completed} completed)`);
  console.log(`  Agents:     ${nextAgent - 1} registered`);
  console.log(`  Validators: ${activeVals} active (${aiVals} AI)`);
  
  if (aiVals === 0) {
    console.log(`\n  ⚠️  No validators registered! Tasks will get stuck at "submitted" state.`);
    console.log(`     To register a validator, send 0.1 ETH to stake:`);
    console.log(`     ValidatorPoolV2.registerValidator(true) with value 0.1 ETH`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const doAll = args.includes('--all') || args.length === 0;
  const doCreate = doAll || args.includes('--create');
  const doClaim = doAll || args.includes('--claim');
  const doSubmit = doAll || args.includes('--submit');
  const doStatus = doAll || args.includes('--status');
  
  console.log('═══════════════════════════════════════════');
  console.log('  AgentEcon Demo Agent Orchestrator v2');
  console.log('  Base Mainnet');
  console.log('═══════════════════════════════════════════');
  
  const agents = loadAgents();
  console.log(`\nLoaded ${agents.length} agents`);
  
  await showBalances(agents);
  await ensureRegistered(agents);
  
  if (doCreate) await createTasks(agents);
  if (doClaim) await claimTasks(agents);
  if (doSubmit) await submitWork(agents);
  if (doStatus) await showStatus();
  
  console.log('\n═══════════════════════════════════════════');
  console.log('  Done!');
  console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
