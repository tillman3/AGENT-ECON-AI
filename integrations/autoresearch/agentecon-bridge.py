#!/usr/bin/env python3
"""
AgentEcon × Autoresearch Bridge

Wraps autoresearch experiment results and submits them to AgentEcon
for on-chain verification and payment.

Usage:
    python agentecon-bridge.py --private-key 0x... --task-id 42

Or with environment variable:
    export AGENTECON_PRIVATE_KEY=0x...
    python agentecon-bridge.py --task-id 42
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    from agentecon import AgentEcon
except ImportError:
    print("Install the AgentEcon SDK first: pip install agentecon")
    sys.exit(1)


def parse_run_log(log_path: str) -> dict:
    """Parse autoresearch run.log for key metrics."""
    metrics = {}
    try:
        content = Path(log_path).read_text()
        for line in content.split("\n"):
            if ":" in line:
                key, _, val = line.partition(":")
                key = key.strip()
                val = val.strip()
                if key in ("val_bpb", "training_seconds", "total_seconds",
                           "peak_vram_mb", "mfu_percent", "total_tokens_M",
                           "num_steps", "num_params_M", "depth"):
                    try:
                        metrics[key] = float(val)
                    except ValueError:
                        pass
    except FileNotFoundError:
        pass
    return metrics


def get_git_hash() -> str:
    """Get current short git hash."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return "unknown"


def run_experiment() -> dict:
    """Run one autoresearch experiment and return metrics."""
    print("\n🔬 Running experiment...")
    result = subprocess.run(
        ["uv", "run", "train.py"],
        capture_output=True,
        text=True,
        timeout=900,  # 15 min max
    )
    
    # Write output to run.log
    with open("run.log", "w") as f:
        f.write(result.stdout)
        if result.stderr:
            f.write("\n--- stderr ---\n")
            f.write(result.stderr)
    
    metrics = parse_run_log("run.log")
    
    if not metrics.get("val_bpb"):
        print("❌ Experiment crashed or produced no results")
        return {"status": "crash"}
    
    print(f"   val_bpb: {metrics['val_bpb']:.6f}")
    print(f"   vram: {metrics.get('peak_vram_mb', 0):.0f} MB")
    return metrics


def main():
    parser = argparse.ArgumentParser(
        description="AgentEcon × Autoresearch Bridge"
    )
    parser.add_argument(
        "--private-key",
        default=os.environ.get("AGENTECON_PRIVATE_KEY"),
        help="Private key for AgentEcon transactions",
    )
    parser.add_argument(
        "--task-id",
        type=int,
        help="AgentEcon task ID to submit results to",
    )
    parser.add_argument(
        "--baseline-bpb",
        type=float,
        default=0.998,
        help="Baseline val_bpb to beat (default: 0.998)",
    )
    parser.add_argument(
        "--max-experiments",
        type=int,
        default=100,
        help="Max experiments to run (default: 100)",
    )
    parser.add_argument(
        "--auto-register",
        action="store_true",
        help="Auto-register as agent if not already registered",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run experiments but don't submit to AgentEcon",
    )
    
    args = parser.parse_args()
    
    if not args.private_key and not args.dry_run:
        print("❌ Private key required. Use --private-key or set AGENTECON_PRIVATE_KEY")
        sys.exit(1)
    
    # Initialize AgentEcon client
    ae = None
    if not args.dry_run:
        ae = AgentEcon(private_key=args.private_key)
        print(f"🔗 Connected to AgentEcon as {ae.address}")
        print(f"   Balance: {ae.balance():.6f} ETH")
        
        # Auto-register if needed
        if args.auto_register and not ae.is_registered():
            print("📝 Registering as agent...")
            ae.register_agent(
                name=f"autoresearch-{ae.address[:8]}",
                specialty="ML optimization / autonomous research",
            )
        
        # Claim task if specified
        if args.task_id is not None:
            print(f"📋 Claiming task {args.task_id}...")
            try:
                ae.claim_task(args.task_id)
            except Exception as e:
                print(f"   (Already claimed or error: {str(e)[:80]})")
    
    print(f"\n{'='*60}")
    print(f"AgentEcon × Autoresearch Bridge")
    print(f"Baseline: {args.baseline_bpb}")
    print(f"Max experiments: {args.max_experiments}")
    print(f"{'='*60}\n")
    
    best_bpb = args.baseline_bpb
    improvements = []
    
    for i in range(1, args.max_experiments + 1):
        print(f"\n{'─'*40}")
        print(f"Experiment {i}/{args.max_experiments}")
        print(f"Best so far: {best_bpb:.6f}")
        
        commit = get_git_hash()
        metrics = run_experiment()
        
        if metrics.get("status") == "crash":
            continue
        
        val_bpb = metrics["val_bpb"]
        
        if val_bpb < best_bpb:
            improvement = best_bpb - val_bpb
            pct = (improvement / best_bpb) * 100
            print(f"🎉 IMPROVEMENT! {best_bpb:.6f} → {val_bpb:.6f} (-{pct:.2f}%)")
            best_bpb = val_bpb
            
            improvements.append({
                "experiment": i,
                "commit": commit,
                "val_bpb": val_bpb,
                "improvement_pct": pct,
                "metrics": metrics,
                "timestamp": int(time.time()),
            })
            
            # Submit to AgentEcon
            if ae and args.task_id is not None:
                work_data = json.dumps({
                    "type": "autoresearch_result",
                    "val_bpb": val_bpb,
                    "baseline": args.baseline_bpb,
                    "improvement_pct": pct,
                    "commit": commit,
                    "experiment_num": i,
                    "metrics": metrics,
                })
                try:
                    ae.submit_work(args.task_id, work_data)
                    print(f"   ✅ Submitted to AgentEcon (task {args.task_id})")
                except Exception as e:
                    print(f"   ⚠️ AgentEcon submission failed: {str(e)[:80]}")
        else:
            print(f"   No improvement ({val_bpb:.6f} >= {best_bpb:.6f})")
    
    # Final summary
    print(f"\n{'='*60}")
    print(f"RESULTS SUMMARY")
    print(f"{'='*60}")
    print(f"Experiments run: {args.max_experiments}")
    print(f"Improvements found: {len(improvements)}")
    print(f"Baseline: {args.baseline_bpb:.6f}")
    print(f"Best achieved: {best_bpb:.6f}")
    if improvements:
        total_pct = ((args.baseline_bpb - best_bpb) / args.baseline_bpb) * 100
        print(f"Total improvement: {total_pct:.2f}%")
        print(f"\nAll improvements:")
        for imp in improvements:
            print(f"  #{imp['experiment']} commit {imp['commit']}: "
                  f"val_bpb={imp['val_bpb']:.6f} (-{imp['improvement_pct']:.2f}%)")
    
    # Save results
    results_path = "agentecon_results.json"
    with open(results_path, "w") as f:
        json.dump({
            "baseline": args.baseline_bpb,
            "best": best_bpb,
            "improvements": improvements,
            "task_id": args.task_id,
        }, f, indent=2)
    print(f"\nResults saved to {results_path}")


if __name__ == "__main__":
    main()
