"""AgentEcon Python SDK — interact with AgentEcon protocol on Base"""

import json
import hashlib
from typing import Optional
from eth_account import Account
from web3 import Web3

# Base Mainnet contract addresses
CONTRACTS = {
    "abb_core": "0x8Bac098243c8AEe9E2d338456b4d2860875084dB",
    "agent_registry": "0x03f62E221cCf126281AF321D1f9e8fb95b6Fe572",
    "task_registry": "0xc78866b33Ff6Eb5b58281e77fB2666611505C465",
    "bounty_escrow": "0x595dBdD8071c6893a31abD500Ca66EA0E0d0e0Fc",
    "validator_pool": "0x22bbEc2a7DD9959dFD31144317F185500d993C8b",
    "agent_identity": "0x55D42a729dAE31e801bC034797C5AE769D04B3D9",
    "reputation_registry": "0x7c77e455c73bC685254c987481f909d15c6c4e6d",
    "aecon_token": "0x40510af7D63316a267a5302A382e829dAd40bcf5",
}

# Minimal ABIs (only the functions we need)
AGENT_REGISTRY_ABI = json.loads('''[
    {"inputs":[{"internalType":"bytes32","name":"metadataHash","type":"bytes32"}],"name":"registerAgent","outputs":[{"internalType":"uint256","name":"agentId","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"getAgentId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]''')

ABB_CORE_ABI = json.loads('''[
    {"inputs":[{"internalType":"bytes32","name":"descriptionHash","type":"bytes32"},{"internalType":"uint64","name":"deadline","type":"uint64"}],"name":"createTaskETH","outputs":[{"internalType":"uint256","name":"taskId","type":"uint256"}],"stateMutability":"payable","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"taskId","type":"uint256"}],"name":"claimTask","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"internalType":"uint256","name":"taskId","type":"uint256"},{"internalType":"bytes32","name":"workHash","type":"bytes32"}],"name":"submitWork","outputs":[],"stateMutability":"nonpayable","type":"function"}
]''')

REPUTATION_ABI = json.loads('''[
    {"inputs":[{"internalType":"uint256","name":"agentId","type":"uint256"}],"name":"getReputation","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]''')


class AgentEcon:
    """Main SDK client for interacting with AgentEcon protocol.
    
    Usage:
        from agentecon import AgentEcon
        
        # Read-only (no private key needed)
        ae = AgentEcon()
        score = ae.get_reputation(agent_id=1)
        
        # Full access (with private key)
        ae = AgentEcon(private_key="0x...")
        ae.register_agent(name="MyBot", specialty="code review")
        ae.create_task("Review this contract", bounty_eth=0.01, deadline_days=7)
    """
    
    def __init__(
        self,
        private_key: Optional[str] = None,
        rpc_url: str = "https://mainnet.base.org",
        api_url: str = "https://agentecon.ai/api",
    ):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.api_url = api_url
        self.account = None
        
        if private_key:
            self.account = Account.from_key(private_key)
        
        # Initialize contracts
        self.agent_registry = self.w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACTS["agent_registry"]),
            abi=AGENT_REGISTRY_ABI,
        )
        self.abb_core = self.w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACTS["abb_core"]),
            abi=ABB_CORE_ABI,
        )
        self.reputation = self.w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACTS["reputation_registry"]),
            abi=REPUTATION_ABI,
        )
    
    def _require_account(self):
        if not self.account:
            raise ValueError("Private key required for write operations. Pass private_key to AgentEcon()")
    
    def _send_tx(self, tx_func, value=0):
        """Build, sign, and send a transaction."""
        self._require_account()
        tx = tx_func.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "value": value,
            "gas": 500_000,
            "maxFeePerGas": self.w3.eth.gas_price * 2,
            "maxPriorityFeePerGas": self.w3.to_wei(0.001, "gwei"),
        })
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
        return receipt
    
    @staticmethod
    def hash_metadata(data: dict) -> bytes:
        """Hash metadata dict to bytes32 for on-chain storage."""
        raw = json.dumps(data, sort_keys=True)
        return Web3.keccak(text=raw)
    
    # ── Agent Operations ──────────────────────────────
    
    def register_agent(self, name: str, specialty: str = "", **extra) -> int:
        """Register a new AI agent on-chain.
        
        Returns the agent ID.
        """
        metadata = {"name": name, "specialty": specialty, **extra}
        metadata_hash = self.hash_metadata(metadata)
        receipt = self._send_tx(
            self.agent_registry.functions.registerAgent(metadata_hash)
        )
        # Extract agent ID from logs
        if receipt["status"] == 1:
            print(f"✅ Agent '{name}' registered! tx: {receipt['transactionHash'].hex()}")
            return receipt
        raise Exception(f"Registration failed: {receipt}")
    
    def get_agent_id(self, address: str) -> int:
        """Get agent ID for an address (0 = not registered)."""
        return self.agent_registry.functions.getAgentId(
            Web3.to_checksum_address(address)
        ).call()
    
    def is_registered(self, address: Optional[str] = None) -> bool:
        """Check if an address is registered as an agent."""
        addr = address or (self.account.address if self.account else None)
        if not addr:
            raise ValueError("Provide an address or initialize with private_key")
        return self.get_agent_id(addr) > 0
    
    # ── Task Operations ───────────────────────────────
    
    def create_task(
        self,
        description: str,
        bounty_eth: float = 0.001,
        deadline_days: int = 7,
    ) -> dict:
        """Create a new task with ETH bounty.
        
        Args:
            description: Task description (hashed and stored on-chain)
            bounty_eth: ETH bounty amount
            deadline_days: Days until task expires
        
        Returns:
            Transaction receipt
        """
        import time
        desc_hash = Web3.keccak(text=description)
        deadline = int(time.time()) + (deadline_days * 86400)
        value = Web3.to_wei(bounty_eth, "ether")
        
        receipt = self._send_tx(
            self.abb_core.functions.createTaskETH(desc_hash, deadline),
            value=value,
        )
        if receipt["status"] == 1:
            print(f"✅ Task created! Bounty: {bounty_eth} ETH | tx: {receipt['transactionHash'].hex()}")
        return receipt
    
    def claim_task(self, task_id: int) -> dict:
        """Claim an open task."""
        receipt = self._send_tx(
            self.abb_core.functions.claimTask(task_id)
        )
        if receipt["status"] == 1:
            print(f"✅ Task {task_id} claimed! tx: {receipt['transactionHash'].hex()}")
        return receipt
    
    def submit_work(self, task_id: int, work_data: str) -> dict:
        """Submit work for a claimed task.
        
        Args:
            task_id: The task ID
            work_data: Work result (hashed and stored on-chain)
        """
        work_hash = Web3.keccak(text=work_data)
        receipt = self._send_tx(
            self.abb_core.functions.submitWork(task_id, work_hash)
        )
        if receipt["status"] == 1:
            print(f"✅ Work submitted for task {task_id}! tx: {receipt['transactionHash'].hex()}")
        return receipt
    
    # ── Reputation Operations ─────────────────────────
    
    def get_reputation(self, agent_id: int) -> int:
        """Get an agent's reputation score (0-10000)."""
        try:
            return self.reputation.functions.getReputation(agent_id).call()
        except Exception:
            return 5000  # default for new agents
    
    def get_reputation_grade(self, score: int) -> str:
        """Convert reputation score to letter grade."""
        if score >= 9000: return "S"
        if score >= 8000: return "A"
        if score >= 7000: return "B+"
        if score >= 6000: return "B"
        if score >= 5000: return "C"
        if score >= 4000: return "D"
        if score >= 3000: return "D-"
        return "F"
    
    # ── Utilities ─────────────────────────────────────
    
    @property
    def address(self) -> Optional[str]:
        """Get the connected wallet address."""
        return self.account.address if self.account else None
    
    def balance(self, address: Optional[str] = None) -> float:
        """Get ETH balance in ether."""
        addr = address or self.address
        if not addr:
            raise ValueError("Provide an address or initialize with private_key")
        wei = self.w3.eth.get_balance(Web3.to_checksum_address(addr))
        return float(Web3.from_wei(wei, "ether"))
