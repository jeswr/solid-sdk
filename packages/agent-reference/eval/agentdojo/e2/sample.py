# AUTHORED-BY Codex GPT-6
"""Freeze a deterministic sample before model use. Never silently replace a lock."""
if __package__ in (None, ""):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "e2"

import argparse
from importlib.metadata import version
from pathlib import Path
import random

from .common import AUTHOR, E1_ROOT, ROOT, atomic_json, canonical, digest, file_hash, verify_lock

SEED = 19002026
SUITES = ("banking", "slack", "travel", "workspace")
PER_SUITE = 30
VERSION = "v1"


def load_suites():
    verify_lock()
    if version("agentdojo") != "0.1.35":
        raise RuntimeError("E2 requires AgentDojo 0.1.35")
    from agentdojo.task_suite import get_suites
    suites = get_suites(VERSION)
    if set(suites) != set(SUITES):
        raise RuntimeError("Benchmark suites changed")
    return suites


def ordered_ids(items):
    return sorted(items, key=lambda name: int(name.rsplit("_", 1)[1]))


def make_sample(suites, per_suite=PER_SUITE):
    benign, attacked = [], []
    for name in SUITES:
        users = ordered_ids(suites[name].user_tasks)
        injections = ordered_ids(suites[name].injection_tasks)
        benign.extend({"suite": name, "task": user, "attack": None} for user in users)
        rng = random.Random(f"{SEED}:{name}")
        strata = list(injections)
        rng.shuffle(strata)
        # Round-robin shuffled strata give balanced injection coverage. Each stratum
        # samples users without replacement, so no pair can occur twice.
        pools = {attack: rng.sample(users, len(users)) for attack in strata}
        count = min(per_suite, len(users) * len(injections))
        for i in range(count):
            attack = strata[i % len(strata)]
            attacked.append({"suite": name, "task": pools[attack].pop(), "attack": attack})
    pilot = [next(row for row in benign if row["suite"] == name) for name in SUITES]
    pilot += [next(row for row in attacked if row["suite"] == name) for name in SUITES]
    return {"version": VERSION, "seed": SEED, "per_suite": per_suite,
            "benign": benign, "attacked": attacked, "pilot": pilot}


def frozen_inputs():
    # MANDATES.lock itself does not cover fitted files. Pin existing fitted data here,
    # without regenerating it or pretending it was included in E1's preregistration.
    paths = [E1_ROOT / "MANDATES.lock", *sorted((E1_ROOT / "mandates/fitted/v1").rglob("*.json")),
             *[E1_ROOT / name for name in verify_lock()["sha256"]]]
    return {str(path.relative_to(E1_ROOT)): file_hash(path) for path in paths}


def benchmark_hash():
    import agentdojo
    base = Path(agentdojo.__file__).parent
    return digest({str(p.relative_to(base)): file_hash(p) for p in sorted(base.rglob("*"))
                   if p.is_file() and p.suffix in {".py", ".yaml", ".yml", ".json", ".txt"}})


def freeze(path=ROOT / "SAMPLE.lock", per_suite=PER_SUITE):
    if Path(path).exists():
        raise RuntimeError("SAMPLE.lock already exists; refusing to replace it")
    payload = make_sample(load_suites(), per_suite)
    payload.update(e1_sha256=frozen_inputs(), benchmark_sha256=benchmark_hash())
    atomic_json(path, {"authored_by": AUTHOR, "sha256": digest(payload), "sample": payload})
    return payload


def verify_sample(path=ROOT / "SAMPLE.lock", suites=None):
    import json
    verify_lock()
    lock = json.loads(Path(path).read_text())
    data = lock["sample"]
    if digest(data) != lock["sha256"]:
        raise RuntimeError("SAMPLE.lock hash mismatch")
    expected = make_sample(suites if suites is not None else load_suites(), data["per_suite"])
    expected.update(e1_sha256=frozen_inputs(), benchmark_sha256=benchmark_hash())
    if canonical(data) != canonical(expected):
        raise RuntimeError("SAMPLE.lock differs from deterministic sample or frozen inputs; stop and report")
    return lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--freeze", action="store_true")
    parser.add_argument("--per-suite", type=int, default=PER_SUITE)
    args = parser.parse_args()
    if args.per_suite < 1:
        parser.error("--per-suite must be positive")
    data = freeze(per_suite=args.per_suite) if args.freeze else verify_sample()["sample"]
    print(f'Verified sample: {len(data["benign"])} benign, {len(data["attacked"])} attacked; pilot {len(data["pilot"])}.')


if __name__ == "__main__":
    main()
