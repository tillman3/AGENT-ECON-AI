import { baseSepolia } from 'wagmi/chains'
import ABBCoreABI from './abis/ABBCore.json'
import AgentRegistryABI from './abis/AgentRegistry.json'
import TaskRegistryABI from './abis/TaskRegistry.json'
import BountyEscrowABI from './abis/BountyEscrow.json'
import ValidatorPoolABI from './abis/ValidatorPool.json'

// V2 deployment (9th deploy, 2026-03-11) — all verified on BaseScan
export const CONTRACTS = {
  abbCore: (process.env.NEXT_PUBLIC_ABBCORE_ADDRESS || '0xBeabCB78713943396e7A5f39b2Cb0659588e5D53') as `0x${string}`,
  agentRegistry: (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS || '0x6f2CE9AC2578eeFf923EEE6E54bA50B6C3DB5EC1') as `0x${string}`,
  taskRegistry: (process.env.NEXT_PUBLIC_TASK_REGISTRY_ADDRESS || '0x11Dfd827A90288E8Fb93a9248FAc2611CfF916F3') as `0x${string}`,
  bountyEscrow: (process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS || '0x58c6f907F5d96752F6a52ed9FF5986c2956C430d') as `0x${string}`,
  validatorPool: (process.env.NEXT_PUBLIC_VALIDATOR_POOL_ADDRESS || '0xaFf016BAFEaE58d0DbA3fF3381C09370CEF85b8c') as `0x${string}`,
  // V2 additions
  agentIdentity: (process.env.NEXT_PUBLIC_AGENT_IDENTITY_ADDRESS || '0xF7110a41aAc656D24FFDB7AB24E6be94FB069E2C') as `0x${string}`,
  reputationRegistry: (process.env.NEXT_PUBLIC_REPUTATION_REGISTRY_ADDRESS || '0xa77613736D7882B12c2a5106C9C0Ab4C151a5c81') as `0x${string}`,
  aeconToken: (process.env.NEXT_PUBLIC_AECON_TOKEN_ADDRESS || '0xe446E55dE9c6FD1E9dC94fFA5399Afd034FFac6A') as `0x${string}`,
  tokenVesting: (process.env.NEXT_PUBLIC_TOKEN_VESTING_ADDRESS || '0xE10c0Bea99a431CbA9B40e449AA116Ed2d94D840') as `0x${string}`,
  validatorStaking: (process.env.NEXT_PUBLIC_VALIDATOR_STAKING_ADDRESS || '0xDab8C69E4674C932475C540F89a9B5F352A551b8') as `0x${string}`,
} as const

export const abbCoreConfig = {
  address: CONTRACTS.abbCore,
  abi: ABBCoreABI,
  chainId: baseSepolia.id,
} as const

export const agentRegistryConfig = {
  address: CONTRACTS.agentRegistry,
  abi: AgentRegistryABI,
  chainId: baseSepolia.id,
} as const

export const taskRegistryConfig = {
  address: CONTRACTS.taskRegistry,
  abi: TaskRegistryABI,
  chainId: baseSepolia.id,
} as const

export const bountyEscrowConfig = {
  address: CONTRACTS.bountyEscrow,
  abi: BountyEscrowABI,
  chainId: baseSepolia.id,
} as const

export const validatorPoolConfig = {
  address: CONTRACTS.validatorPool,
  abi: ValidatorPoolABI,
  chainId: baseSepolia.id,
} as const
