"""Data types for AgentEcon SDK"""

from dataclasses import dataclass
from enum import IntEnum
from typing import Optional


class TaskStatus(IntEnum):
    OPEN = 0
    CLAIMED = 1
    SUBMITTED = 2
    VALIDATED = 3
    COMPLETED = 4
    EXPIRED = 5
    DISPUTED = 6


@dataclass
class Task:
    id: int
    creator: str
    description_hash: str
    bounty_amount: int  # in wei
    deadline: int  # unix timestamp
    status: TaskStatus = TaskStatus.OPEN
    claimer: Optional[str] = None
    work_hash: Optional[str] = None


@dataclass
class Agent:
    id: int
    address: str
    metadata_hash: str
    reputation_score: int = 5000  # 0-10000
    tasks_completed: int = 0
    tasks_failed: int = 0
