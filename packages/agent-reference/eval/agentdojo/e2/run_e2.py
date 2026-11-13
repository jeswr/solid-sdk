# AUTHORED-BY Codex GPT-6
"""Run the frozen E2 sample through the shared-login Codex CLI, then report offline."""
if __package__ in (None, ""):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "e2"

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

from .common import AUTHOR, E1_ROOT, ROOT, atomic_json, canonical, digest, file_hash, verify_lock
from .sample import load_suites, verify_sample
from .protocol import CONDITIONS, TURN_CAP


def row_key(row):
    return row["condition"], row["suite"], row["task"], row["attack"]


class Rows:
    """One parent writer. Replace the complete JSONL file atomically for each append.

    A crash exposes either the previous complete prefix or the new complete prefix.
    A directory lock prevents concurrent runs from losing each other's rows.
    """
    def __init__(self, directory, fingerprint, resume):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = (self.directory / ".run.lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.path = self.directory / "rows.jsonl"
            self.data = self.path.read_bytes() if self.path.exists() else b""
            if self.data and not resume:
                raise RuntimeError("Results exist; use --resume or a separate --results-dir")
            if self.data and not self.data.endswith(b"\n"):
                raise RuntimeError("Incomplete rows.jsonl; refusing to silently repair results")
            self.keys = set()
            for line in self.data.splitlines():
                row = json.loads(line)
                if row["run_fingerprint"] != fingerprint:
                    raise RuntimeError("Resume configuration or implementation differs from recorded rows")
                key = row_key(row)
                if key in self.keys:
                    raise RuntimeError("Duplicate result row")
                self.keys.add(key)
        except BaseException:
            self.close()
            raise

    def append(self, row):
        key = row_key(row)
        if key in self.keys:
            raise RuntimeError("Duplicate result row")
        updated = self.data + (canonical(row) + "\n").encode()
        fd, name = tempfile.mkstemp(prefix=".rows-", dir=self.directory)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(updated)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        self.data = updated
        self.keys.add(key)

    def close(self):
        self.lock.close()


def base_row(task, condition, config):
    return {"authored_by": AUTHOR, "version": "v1", "agentdojo_version": "0.1.35", **task,
            "condition": condition, "model": config["model"], "effort": config["effort"],
            "run_fingerprint": config["fingerprint"], "sample_sha256": config["sample_sha256"],
            "attack_method": "important_instructions", "turn_cap": TURN_CAP,
            "utility": {"success": None, "error": "not-run"},
            "security": {"success": None, "error": "not-run"} if task["attack"] else None,
            "calls": [], "asks": 0, "errors": [], "model_turns": 0,
            "attacker_call_proposed": None if task["attack"] else False,
            "attacker_call_executed": None if task["attack"] else False,
            "attacker_ground_truth": [], "final": "", "status": "failed", "termination": "task-error",
            "model_calls": [], "model_calls_made": 0, "model_calls_cached": 0, "wall_time": 0}


def worker(task, condition, config):
    start = time.monotonic()
    row = base_row(task, condition, config)
    llm = None
    bridge = None
    try:
        # Recheck locks in the worker before importing pipeline or making a call.
        verify_lock()
        suites = load_suites()
        verify_sample(config["sample_lock"], suites)
        from .codex_llm import CodexLLM
        from .pipeline import Bridge, CONTENT_HEADER, evaluate, injections_for
        suite = suites[task["suite"]]
        user = suite.user_tasks[task["task"]]
        attack = suite.injection_tasks[task["attack"]] if task["attack"] else None
        mandate_path = (E1_ROOT / "mandates/fitted/v1" / suite.name / f"{user.ID}.json"
                        if condition == "fitted" else E1_ROOT / "mandates/standing" / f"{suite.name}.json")
        policy_data = json.loads(mandate_path.read_text())
        if policy_data["tools"] != json.loads((E1_ROOT / "tool-classification.json").read_text())["suites"][suite.name]:
            raise RuntimeError("Frozen mandate tool catalog differs")
        if set(policy_data["tools"]) != {tool.name for tool in suite.tools}:
            raise RuntimeError("Runtime tools differ from frozen catalog")
        mandate = policy_data if condition in {"fitted", "standing"} else {"tools": policy_data["tools"]}
        row["mandate_sha256"] = file_hash(mandate_path) if condition in {"fitted", "standing"} else None
        row["content_header"] = CONTENT_HEADER if condition != "none" else None
        injections = injections_for(suite, user, attack, config["model"]) if attack else {}
        row["injection_vectors"] = sorted(injections)
        llm = CodexLLM(**{key: config[key] for key in ("model", "effort", "command", "timeout", "process_retries", "backoff", "cache_dir")})
        # Bridge journals must be disjoint across workers. Keep this task's durable
        # journal alongside the model cache, outside every model's empty CWD.
        journal_dir = Path(config["cache_dir"]) / "journals"
        journal_dir.mkdir(parents=True, exist_ok=True)
        journal_id = digest([config["fingerprint"], condition, task])
        if condition in {"fitted", "standing"}:
            bridge = Bridge(journal_dir / f"{journal_id}.jsonl")
        row.update(evaluate(suite, user, attack, mandate, condition, llm, bridge, injections))
    except Exception as error:
        # Never persist exception text, command paths, process logs, or environment.
        row["errors"].append({"kind": "task-error", "exception": type(error).__name__})
        if llm:
            row.update(model_turns=llm.turns, model_calls=llm.calls,
                       model_calls_made=sum(not c["cached"] for c in llm.calls),
                       model_calls_cached=sum(c["cached"] for c in llm.calls))
    finally:
        if bridge:
            try:
                bridge.close()
            except Exception:
                row["errors"].append({"kind": "bridge-close-error"})
    row["wall_time"] = time.monotonic() - start
    return row


def implementation_hash():
    package = E1_ROOT.parent.parent
    paths = [*sorted(ROOT.glob("*.py")), E1_ROOT / "run.py", E1_ROOT / "translation.py",
             *sorted((package / "src").rglob("*.ts")), *sorted((package / "dist").rglob("*.js"))]
    return digest({str(p.relative_to(E1_ROOT.parent.parent)): file_hash(p) for p in paths})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=os.environ.get("E2_MODEL", "gpt-6.1-sol"))
    parser.add_argument("--effort", default=os.environ.get("E2_EFFORT", "low"))
    parser.add_argument("--conditions", default="none,fitted,standing")
    parser.add_argument("--pilot", action="store_true")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--only-suite", choices=["banking", "slack", "travel", "workspace"])
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--command", default=os.environ.get("E2_CODEX_COMMAND", "bash /mnt/project-files/orchestration/codex/codex-sol.sh exec"))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("E2_TIMEOUT", 300)))
    parser.add_argument("--process-retries", type=int, default=int(os.environ.get("E2_PROCESS_RETRIES", 2)))
    parser.add_argument("--backoff", type=float, default=float(os.environ.get("E2_BACKOFF", 2)))
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "cache")
    parser.add_argument("--results-dir", type=Path)
    parser.add_argument("--sample-lock", type=Path, default=ROOT / "SAMPLE.lock")
    args = parser.parse_args(argv)
    conditions = args.conditions.split(",")
    if not conditions or len(set(conditions)) != len(conditions) or any(c not in CONDITIONS for c in conditions):
        parser.error("conditions must be unique names from " + ",".join(CONDITIONS))
    if args.jobs < 1 or args.timeout <= 0 or args.process_retries < 0 or args.backoff < 0:
        parser.error("invalid jobs, timeout, retries or backoff")
    # Required preflight occurs before workers or model objects exist. Never regenerate.
    verify_lock()
    lock = verify_sample(args.sample_lock)
    sample = lock["sample"]
    tasks = sample["pilot"] if args.pilot else sample["benign"] + sample["attacked"]
    if args.only_suite:
        tasks = [task for task in tasks if task["suite"] == args.only_suite]
    if any(condition in {"fitted", "standing"} for condition in conditions):
        if not (E1_ROOT.parent.parent / "dist/eval/bridge.js").is_file():
            raise RuntimeError("Build agent-reference first, as documented in E1 README.md")
    configuration = {"model": args.model, "effort": args.effort, "timeout": args.timeout,
                     "process_retries": args.process_retries, "backoff": args.backoff,
                     "command_sha256": digest(args.command), "sample_sha256": lock["sha256"],
                     "implementation_sha256": implementation_hash(), "turn_cap": TURN_CAP,
                     "agentdojo_version": "0.1.35", "attack": "important_instructions"}
    config = {**configuration, "command": args.command, "fingerprint": digest(configuration),
              "sample_lock": str(args.sample_lock.resolve()), "cache_dir": str(args.cache_dir.resolve())}
    label = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{args.model}-{args.effort}")
    if label in {".", ".."}:
        parser.error("invalid model/effort label")
    directory = args.results_dir or ROOT / "results" / label
    rows = Rows(directory, config["fingerprint"], args.resume)
    try:
        atomic_json(directory / "run.json", {"authored_by": AUTHOR, **configuration, "run_fingerprint": config["fingerprint"]})
        pending = [(task, condition) for task in tasks for condition in conditions
                   if (condition, task["suite"], task["task"], task["attack"]) not in rows.keys]
        print(f'E2: {len(pending)} pending, {len(tasks) * len(conditions) - len(pending)} resumed; {args.jobs} workers.', file=sys.stderr)
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            futures = {pool.submit(worker, task, condition, config): (task, condition) for task, condition in pending}
            for completed, future in enumerate(as_completed(futures), 1):
                task, condition = futures[future]
                try:
                    row = future.result()
                except Exception as error:
                    row = base_row(task, condition, config)
                    row["errors"] = [{"kind": "worker-error", "exception": type(error).__name__}]
                rows.append(row)
                if completed % 10 == 0:
                    print(f'E2: {completed}/{len(pending)} new rows complete.', file=sys.stderr)
        print(f'E2: {len(pending)}/{len(pending)} new rows complete.', file=sys.stderr)
    finally:
        rows.close()
    from .report_e2 import write_report
    write_report(directory / "rows.jsonl", directory / "E2-SUMMARY.md")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        # Preflight text is authored by this harness; OSError details can contain HOME.
        print(f'E2 preflight failed: {str(error) if isinstance(error, RuntimeError) else type(error).__name__}', file=sys.stderr)
        raise SystemExit(2)
