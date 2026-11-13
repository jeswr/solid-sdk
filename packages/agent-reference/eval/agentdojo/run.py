# AUTHORED-BY Codex GPT-6
"""Offline E1 replay. Run with ../.venv/bin/python run.py from this directory."""
import argparse
import collections
import hashlib
import json
import os
import statistics
import subprocess
from importlib.metadata import version as installed_version
from pathlib import Path

from translation import ROOT, Context, classifications, effects, json_value, payment_limit, request_for, verify_lock

# Verify the preregistration BEFORE importing task_suite (which imports injection tasks).
LOCK = verify_lock()
from agentdojo.functions_runtime import FunctionCall, FunctionsRuntime
from agentdojo.task_suite import get_suites

PACKAGE = ROOT.parent.parent
AUTHOR = "Codex GPT-6"
DEFAULT_ENVIRONMENTS = {}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True, allow_nan=False) + "\n")


class Bridge:
    def __init__(self):
        (ROOT / "cache").mkdir(exist_ok=True)
        self.journal = (ROOT / "cache/bridge.jsonl").open("w")
        self.journal.close()
        self.process = subprocess.Popen(
            ["/opt/node24/bin/node", str(PACKAGE / "dist/eval/bridge.js"), str(ROOT / "cache/bridge.jsonl")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
        )

    def decide(self, request):
        self.process.stdin.write(json.dumps(request, allow_nan=False) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f"Bridge exited: {self.process.poll()}")
        decision = json.loads(line)
        if "error" in decision:
            raise RuntimeError(decision["error"])
        return decision

    def close(self):
        self.process.stdin.close()
        if self.process.wait(timeout=20) != 0:
            raise RuntimeError("Bridge failed")


def ordered(tasks):
    return sorted(tasks.values(), key=lambda t: int(t.ID.rsplit("_", 1)[1]))


def run_calls(calls, *, env, context, task, mandate, max_payment, runtime, bridge, principal, phase, records, trace):
    for original in calls:
        # The runtime can execute nested calls on its own. Refuse that escape hatch rather
        # than letting a nested action execute outside the gate. Default suites have none.
        if any(isinstance(arg, FunctionCall) for arg in original.args.values()):
            raise RuntimeError("Nested calls need individual gate releases")
        call = original.model_copy(deep=True)
        definition = mandate["tools"][call.function]
        request = request_for(call, definition, env, context, task.PROMPT, mandate, max_payment)
        decision = bridge.decide(request) if principal != "no-gate" else {
            "outcome": "go", "reason": None, "checks": [], "referenceChecks": [], "bypass": True,
        }
        allowed = decision["outcome"] == "go" or (decision["outcome"] == "ask-principal" and principal == "approve")
        record = {
            "phase": phase, "tool": call.function, "args": json_value(call.args), "class": definition["class"],
            "recipients": request["recipients"], "amounts": request["amounts"], "free_text": request["freeText"],
            "context_ids": [item["id"] for item in context.items],
            **{k: v for k, v in decision.items() if k != "ownerMandate"},
            "executed": allowed, "principal_approved": decision["outcome"] == "ask-principal" and allowed,
        }
        # The bridge journals the verdict before returning; additionally journal the
        # simulated principal decision before executing, and its result afterwards.
        with (ROOT / "cache/execution.jsonl").open("a") as journal:
            journal.write(json.dumps({"stage": "before", "call": record}) + "\n")
            journal.flush()
            os.fsync(journal.fileno())
        if allowed:
            result, error = runtime.run_function(env, call.function, call.args)
            trace.append(call)
            record["runtime_error"] = error
            context.observe(call.function, definition, result, error)
            record["output"] = json_value(result)
            record["output_label"] = definition["output"]
        with (ROOT / "cache/execution.jsonl").open("a") as journal:
            journal.write(json.dumps({"stage": "after", "call": record}) + "\n")
        records.append(record)


def score(task, method, output, pre, post, trace):
    # Prefer the benchmark's trace override, exactly as TaskSuite does. Still call the
    # named utility/security where implemented and record it separately.
    raw, raw_error = None, None
    try:
        raw = bool(getattr(task, method)(output, pre.model_copy(deep=True), post.model_copy(deep=True)))
    except Exception as error:
        raw_error = f"{type(error).__name__}: {error}"
    try:
        from_trace = getattr(task, f"{method}_from_traces")(
            output, pre.model_copy(deep=True), post.model_copy(deep=True), trace,
        )
        value = bool(from_trace) if from_trace is not None else raw
        return {"success": value, "method": f"{method}_from_traces" if from_trace is not None else method,
                "direct_result": raw, "direct_error": raw_error,
                "error": raw_error if value is None else None}
    except Exception as error:
        return {"success": None, "method": f"{method}_from_traces", "direct_result": raw,
                "direct_error": raw_error, "error": f"{type(error).__name__}: {error}"}


def initialized(suite, user):
    # YAML parsing is expensive; deep copies preserve fresh-environment semantics.
    key = id(suite)
    if key not in DEFAULT_ENVIRONMENTS:
        DEFAULT_ENVIRONMENTS[key] = suite.load_and_inject_default_environment({})
    return user.init_environment(DEFAULT_ENVIRONMENTS[key].model_copy(deep=True))


def fitted(suite, user, tools, bridge, version):
    env = initialized(suite, user)
    runtime = FunctionsRuntime(suite.tools)
    calls = user.ground_truth(env.model_copy(deep=True))
    grants = []
    for original in calls:
        call = original.model_copy(deep=True)
        recipients, amounts, _ = effects(call.function, call.args, tools[call.function], env)
        grants.append({"tool": call.function, "recipients": recipients, "amounts": amounts})
        # Fitted scope extraction runs ONLY the user's oracle on a separate environment.
        runtime.run_function(env, call.function, call.args)
    data = {"authored_by": AUTHOR, "kind": "fitted", "suite": suite.name,
            "task": user.ID, "tools": tools, "grants": grants}
    write_json(ROOT / "mandates/fitted" / version / suite.name / f"{user.ID}.json", data)
    return data


def replay(suite, user, attack, mandate, bridge, principal):
    env = initialized(suite, user)
    pre = env.model_copy(deep=True)
    runtime = FunctionsRuntime(suite.tools)
    user_calls = user.ground_truth(pre.model_copy(deep=True))
    context = Context()
    records, trace = [], []
    limit = payment_limit(pre)
    kwargs = dict(env=env, context=context, task=user, mandate=mandate, max_payment=limit,
                  runtime=runtime, bridge=bridge, principal=principal, records=records, trace=trace)
    # A frozen classification determines the nominal injection point. If its call is
    # refused/errors, no content was returned: fall back to the specified start point.
    # Compute actual point on an isolated probe with the SAME gate/principal decisions.
    # The probe is avoided: prefix calls without successful content are already executed
    # here; if none returns content, restart at the start with a fresh environment below.
    injected = False
    injection_calls = None
    injection_point = None

    def inject():
        nonlocal injection_calls, injected, injection_point
        injection_point = len(records)
        try:
            injection_calls = attack.ground_truth(env.model_copy(deep=True))
            run_calls(injection_calls, phase="attack", **kwargs)
        except Exception as error:
            raise RuntimeError(f"{suite.name}/{user.ID}/{attack.ID} ground truth: {error}") from error
        injected = True

    # If the oracle contains no content-returning tools, inject at the start.
    nominal_content = any(mandate["tools"][c.function]["output"] == "content" for c in user_calls)
    if attack is not None and not nominal_content:
        inject()
    for call in user_calls:
        run_calls([call], phase="user", **kwargs)
        record = records[-1]
        if attack is not None and not injected and record["executed"] and not record.get("runtime_error") and record.get("output_label") == "content":
            inject()
    if attack is not None and not injected:
        # A dynamic absence of content is replayed from the start, not after the user.
        return replay_at_start(suite, user, attack, mandate, bridge, principal)
    complete = all(r["executed"] and r.get("runtime_error") is None for r in records if r["phase"] == "user")
    user_output = user.GROUND_TRUTH_OUTPUT if complete else ""
    attack_output = attack.GROUND_TRUTH_OUTPUT if attack is not None else user_output
    return {
        "calls": records, "context": context.items, "max_payment": limit,
        "asks": sum(r["outcome"] == "ask-principal" for r in records),
        "utility": score(user, "utility", user_output, pre, env, trace),
        "security": score(attack, "security", attack_output, pre, env, trace) if attack is not None else None,
        "injection_point": injection_point,
        "attack_call_count": len(injection_calls) if injection_calls is not None else None,
        "oracle_final_output": attack_output,
    }


def replay_at_start(suite, user, attack, mandate, bridge, principal):
    env = initialized(suite, user)
    pre = env.model_copy(deep=True)
    context, records, trace = Context(), [], []
    limit = payment_limit(pre)
    kwargs = dict(env=env, context=context, task=user, mandate=mandate, max_payment=limit,
                  runtime=FunctionsRuntime(suite.tools), bridge=bridge, principal=principal, records=records, trace=trace)
    attack_calls = attack.ground_truth(env.model_copy(deep=True))
    run_calls(attack_calls, phase="attack", **kwargs)
    run_calls(user.ground_truth(pre.model_copy(deep=True)), phase="user", **kwargs)
    complete = all(r["executed"] and r.get("runtime_error") is None for r in records if r["phase"] == "user")
    return {"calls": records, "context": context.items, "max_payment": limit,
            "asks": sum(r["outcome"] == "ask-principal" for r in records),
            "utility": score(user, "utility", user.GROUND_TRUTH_OUTPUT if complete else "", pre, env, trace),
            "security": score(attack, "security", attack.GROUND_TRUTH_OUTPUT, pre, env, trace),
            "injection_point": 0, "attack_call_count": len(attack_calls),
            "oracle_final_output": attack.GROUND_TRUTH_OUTPUT, "fallback": "no successful content output"}


def fraction(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator,
            "share": numerator / denominator if denominator else None}


def summarize(version, suite, kind, utility, attacks):
    n = len(utility)
    ask_counts = [r["variants"]["refuse"]["asks"] for r in utility]
    stopped = []
    for r in utility:
        stops = [c for c in r["variants"]["refuse"]["calls"] if c["outcome"] == "stop"]
        if stops:
            stopped.append({"task": r["task"], "reasons": sorted(set(c["reason"] for c in stops))})
    check_counts = {}
    for principal in ("refuse", "approve"):
        counts = collections.Counter()
        for r in attacks:
            for call in r["variants"][principal]["calls"]:
                if call["phase"] == "attack" and call["outcome"] in ("stop", "ask-principal"):
                    counts[(call["decidingCheck"], call["reason"], call["outcome"])] += 1
        check_counts[principal] = [dict(check=c, reason=r, outcome=o, count=n) for (c, r, o), n in sorted(counts.items())]
    successful = []
    for r in attacks:
        variant = r["variants"]["refuse"]
        if variant["security"]["success"]:
            successful.append({"task": r["task"], "attack": r["attack"],
                               "attack_go_calls": [c for c in variant["calls"] if c["phase"] == "attack" and c["outcome"] == "go"],
                               "all_go_calls": [c for c in variant["calls"] if c["outcome"] == "go"],
                               "oracle_final_output": variant["oracle_final_output"]})
    return {
        "version": version, "suite": suite, "mandate": kind,
        "user_tasks": n,
        "finished_no_gate": fraction(sum(bool(r["variants"]["no-gate"]["utility"]["success"]) for r in utility), n),
        "finished_no_ask": fraction(sum(bool(r["variants"]["refuse"]["utility"]["success"]) and r["variants"]["refuse"]["asks"] == 0 for r in utility), n),
        "finished_refusing_asks": fraction(sum(bool(r["variants"]["refuse"]["utility"]["success"]) for r in utility), n),
        "finished_approving_asks": fraction(sum(bool(r["variants"]["approve"]["utility"]["success"]) for r in utility), n),
        "asks_per_task": {"mean": statistics.mean(ask_counts), "median": statistics.median(ask_counts), "max": max(ask_counts), "sum": sum(ask_counts)},
        "asks_per_task_approving": {"mean": statistics.mean(r["variants"]["approve"]["asks"] for r in utility), "median": statistics.median(r["variants"]["approve"]["asks"] for r in utility), "max": max(r["variants"]["approve"]["asks"] for r in utility)},
        "tasks_stopped": stopped,
        "pairs": len(attacks),
        "attack_success": {p: fraction(sum(bool(r["variants"][p]["security"]["success"]) for r in attacks), len(attacks)) for p in ("no-gate", "refuse", "approve")},
        "attack_deciding_checks": check_counts,
        "surviving_attacks_refusing": successful,
        "unreproduced_no_gate": [{"task": r["task"], "attack": r["attack"], "empty_ground_truth": r["variants"]["no-gate"]["attack_call_count"] == 0} for r in attacks if not r["variants"]["no-gate"]["security"]["success"]],
        "scoring_errors": [{"task": r["task"], "attack": r.get("attack"), "principal": p, "error": v["security" if "attack" in r else "utility"]["error"]} for r in [*utility, *attacks] for p, v in r["variants"].items() if v["security" if "attack" in r else "utility"]["error"]],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", action="append", choices=["v1", "v1.2"])
    args = parser.parse_args()
    catalog = classifications()
    bridge = Bridge()
    (ROOT / "cache/execution.jsonl").write_text("")
    metadata = {"authored_by": AUTHOR, "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PACKAGE, text=True).strip(),
                "agentdojo_version": installed_version("agentdojo"), "mandate_lock": LOCK,
                "model_calls": 0, "principal": "simulated all-refuse/all-approve; no signature or approval UX evaluation",
                "check_implementation": {"mandate": "reference evaluateIntent + OutboundGate.release; fitted amount scope adapter", "recipient": "adapter known/instruction-or-own-record; fitted recipient scope", "disclosure": "adapter UNS-9; fitted grant", "data-terms": "adapter standing context grant; fitted grant", "limits-approval": "reference sensitive approvals; adapter payment-history limit", "evidence": "reference sealEffect; adapter synchronous flushed journal before execution"},
                "source_sha256": {str(p.relative_to(PACKAGE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [*sorted((PACKAGE / "src/eval").glob("*.ts")), *sorted(ROOT.glob("*.py"))]}}
    summaries = []
    try:
        for version in args.version or ["v1", "v1.2"]:
            containers = {kind: {"metadata": metadata, "version": version, "mandate": kind, "utility": [], "attacks": []} for kind in ("fitted", "standing")}
            for suite_name, suite in get_suites(version).items():
                tools = catalog[suite_name]
                if set(tools) != {t.name for t in suite.tools}:
                    raise RuntimeError(f"Frozen tools differ for {version}/{suite_name}")
                for kind in ("fitted", "standing"):
                    utility, attacks = [], []
                    for user in ordered(suite.user_tasks):
                        mandate = fitted(suite, user, tools, bridge, version) if kind == "fitted" else json.loads((ROOT / "mandates/standing" / f"{suite_name}.json").read_text())
                        utility.append({"suite": suite_name, "task": user.ID, "variants": {p: replay(suite, user, None, mandate, bridge, p) for p in ("no-gate", "refuse", "approve")}})
                        for attack in ordered(suite.injection_tasks):
                            attacks.append({"suite": suite_name, "task": user.ID, "attack": attack.ID,
                                            "variants": {p: replay(suite, user, attack, mandate, bridge, p) for p in ("no-gate", "refuse", "approve")}})
                    containers[kind]["utility"].extend(utility)
                    containers[kind]["attacks"].extend(attacks)
                    summaries.append(summarize(version, suite_name, kind, utility, attacks))
                    print(f"Completed {version}/{suite_name}/{kind}: {len(utility)} tasks, {len(attacks)} pairs", flush=True)
            for kind, data in containers.items():
                write_json(ROOT / "results" / version / f"{kind}.json", data)
        write_json(ROOT / "results/summary.json", {"metadata": metadata, "groups": summaries})
    finally:
        bridge.close()


if __name__ == "__main__":
    main()
