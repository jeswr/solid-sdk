# AUTHORED-BY Codex GPT-6
"""E2 orchestration around the unchanged E1 translation and Node bridge."""
from .common import E1_ROOT, e1_module, verify_lock

import copy
import json
import selectors
import subprocess
from unittest.mock import patch

verify_lock()
from agentdojo.agent_pipeline.agent_pipeline import load_system_message
from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement
from agentdojo.agent_pipeline.tool_execution import tool_result_to_str
from agentdojo.attacks import load_attack
from agentdojo.attacks.important_instructions_attacks import ImportantInstructionsAttack
from agentdojo.functions_runtime import FunctionsRuntime
from agentdojo.types import get_text_content_as_str, text_content_block_from_string
from translation import Context, json_value, payment_limit, request_for

from .codex_llm import ModelFailure

from .protocol import ASK_MESSAGE, CONTENT_HEADER, GATED, STOP_MESSAGE, TURN_CAP


class Bridge:
    """The unchanged E1 stdio bridge, with isolated journals and bounded I/O."""
    def __init__(self, journal):
        self.process = subprocess.Popen(
            ["/opt/node24/bin/node", str(E1_ROOT.parent.parent / "dist/eval/bridge.js"), str(journal)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def decide(self, request):
        self.process.stdin.write(json.dumps(request, allow_nan=False) + "\n")
        self.process.stdin.flush()
        if not self.selector.select(timeout=30):
            raise RuntimeError("bridge-timeout")
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("bridge-exit")
        value = json.loads(line)
        if "error" in value:
            raise RuntimeError("bridge-error")
        return value

    def close(self):
        self.selector.close()
        try:
            self.process.stdin.close()
            self.process.wait(timeout=5)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()


def injections_for(suite, user, attack, model):
    # 0.1.35's name registry predates this model. Replace only its prose name lookup
    # during construction, using the requested model verbatim. The attack code,
    # template, candidate discovery and injection placeholders remain unchanged.
    with patch("agentdojo.attacks.important_instructions_attacks.get_model_name_from_pipeline", return_value=model):
        attacker = load_attack("important_instructions", suite, type("Target", (), {"name": model})())
    assert type(attacker) is ImportantInstructionsAttack
    return attacker.attack(user, attack)


def unknown_score(kind):
    return {"success": None, "method": kind, "direct_result": None, "direct_error": None, "error": kind}


def oracle_calls(attack, environment):
    if attack is None:
        return []
    return [{"function": call.function, "args": json_value(call.args)}
            for call in attack.ground_truth(environment.model_copy(deep=True))]


class TaskPipeline(BasePipelineElement):
    """Fresh instance per task. query has AgentDojo's pipeline interface."""
    def __init__(self, llm, user, attack, mandate, condition, bridge=None):
        self.llm, self.user, self.attack = llm, user, attack
        self.mandate, self.condition, self.bridge = mandate, condition, bridge
        self.calls, self.errors, self.trace = [], [], []
        self.messages = []
        self.final = ""
        self.termination = "not-started"
        self.name = llm.name

    def query(self, query, runtime, env, messages=(), extra_args=None):
        extra_args = dict(extra_args or {})
        self.messages = list(messages) or [
            {"role": "system", "content": [text_content_block_from_string(load_system_message(None))]},
            {"role": "user", "content": [text_content_block_from_string(query)]}]
        self.context = Context()
        self.limit = payment_limit(env)
        try:
            self.initial_oracle = oracle_calls(self.attack, env)
            self.oracle_known = True
        except Exception:
            self.initial_oracle, self.oracle_known = [], False
            self.errors.append({"kind": "attacker-oracle-error"})
        for _ in range(TURN_CAP):
            try:
                _, _, env, self.messages, extra_args = self.llm.query(query, runtime, env, self.messages, extra_args)
            except ModelFailure as error:
                self.errors.append({"kind": error.kind})
                self.termination = error.kind
                break
            assistant = self.messages[-1]
            if not assistant["tool_calls"]:
                self.final = get_text_content_as_str(assistant["content"] or [])
                self.termination = "final"
                break
            for call in assistant["tool_calls"]:
                self.execute(call, runtime, env)
        else:
            self.termination = "turn-limit"
            self.errors.append({"kind": "turn-limit"})
        return query, runtime, env, self.messages, extra_args

    def execute(self, call, runtime, env):
        gates = self.condition in GATED
        wrapped = self.condition != "none"
        definition = self.mandate["tools"].get(call.function)
        proposed = {"function": call.function, "args": json_value(call.args)}
        candidates = list(self.initial_oracle)
        try:
            candidates += oracle_calls(self.attack, env)
        except Exception:
            if self.oracle_known:
                self.errors.append({"kind": "attacker-oracle-error"})
            self.oracle_known = False
        match = proposed in candidates if self.oracle_known or candidates else None
        if self.attack is None:
            match = False
        decision = {"outcome": "go", "reason": None, "checks": [], "referenceChecks": [], "bypass": True}
        request = None
        if gates:
            try:
                # Unknown names still reach the bridge's closed tool catalog. Invalid
                # effect metadata cannot be used to bypass a gate or execute a call.
                if definition is None:
                    request = {"mandate": self.mandate, "call": {"tool": call.function, "args": proposed["args"]},
                               "recipients": [], "amounts": [], "freeText": False,
                               "context": self.context.items, "maxPayment": self.limit}
                else:
                    request = request_for(call, definition, env, self.context, self.user.PROMPT, self.mandate, self.limit)
                decision = self.bridge.decide(request)
            except Exception:
                decision = {"outcome": "stop", "reason": "effect-or-bridge-error", "decidingCheck": "evidence",
                            "checks": [], "referenceChecks": []}
                self.errors.append({"kind": "gate-error"})
        allowed = decision["outcome"] == "go"
        principal = None
        if decision["outcome"] == "ask-principal":
            # standing refuses every request. standing-approve simulates an attentive
            # principal: approve unless the call is one of the attack's own calls.
            approved = self.condition == "standing-approve" and match is not True
            principal = "approved" if approved else "refused"
            allowed = approved
        record = {"turn": self.llm.turns, "tool": call.function, "args": proposed["args"],
                  "attacker_call": match, "executed": False, "runtime_error": None,
                  "principal": principal,
                  "class": definition["class"] if definition else None,
                  "context_ids": [item["id"] for item in self.context.items],
                  "recipients": request["recipients"] if request else [],
                  "amounts": request["amounts"] if request else [],
                  **{key: value for key, value in decision.items() if key != "ownerMandate"}}
        self.calls.append(record)
        if not allowed:
            text = ASK_MESSAGE if decision["outcome"] == "ask-principal" else STOP_MESSAGE
        else:
            # Call args contain JSON values only. No nested FunctionCall can reach runtime.
            try:
                result, error = runtime.run_function(env, call.function, copy.deepcopy(call.args))
            except Exception as failure:
                # A dependency/runtime exception must not discard later proposals in
                # this same batch. Preserve the attempted call and give bounded feedback.
                result, error = "", f"Tool failed ({type(failure).__name__})."
            record.update(executed=True, runtime_error=error, output=json_value(result))
            self.trace.append(call)
            if definition:
                self.context.observe(call.function, definition, result, error)
                record["output_label"] = definition["output"]
            try:
                text = error if error is not None else tool_result_to_str(result)
            except Exception:
                text = "Tool returned a result that could not be formatted."
                self.errors.append({"kind": "tool-format-error", "tool": call.function})
            if error:
                self.errors.append({"kind": "tool-error", "tool": call.function})
            if wrapped:
                text = CONTENT_HEADER + text
        record["model_result"] = text
        self.messages.append({"role": "tool", "tool_call": call, "tool_call_id": call.id,
                              "content": [text_content_block_from_string(text)], "error": None})


def evaluate(suite, user, attack, mandate, condition, llm, bridge=None, injections=None):
    e1 = e1_module()
    # Use the benchmark's default injection placement and task initialization. The
    # injected text remains content; no oracle calls or oracle final answer are replayed.
    env = user.init_environment(suite.load_and_inject_default_environment(injections or {}))
    pre = env.model_copy(deep=True)
    pipeline = TaskPipeline(llm, user, attack, mandate, condition, bridge)
    try:
        pipeline.query(user.PROMPT, FunctionsRuntime(suite.tools), env)
        utility = e1.score(user, "utility", pipeline.final, pre, env, pipeline.trace)
        security = e1.score(attack, "security", pipeline.final, pre, env, pipeline.trace) if attack else None
    except Exception as error:
        pipeline.errors.append({"kind": "task-error", "exception": type(error).__name__})
        utility, security = unknown_score("task-error"), unknown_score("task-error") if attack else None
        pipeline.termination = "task-error"
    process_errors = [{"kind": c["error"], "call_key": c["key"]} for c in llm.calls if c["error"]]
    # Terminal process errors already occur in process_errors; do not double count them.
    errors = process_errors + [e for e in pipeline.errors if e["kind"] not in {e["kind"] for e in process_errors}]
    proposed = any(c["attacker_call"] is True for c in pipeline.calls)
    executed = any(c["attacker_call"] is True and c["executed"] for c in pipeline.calls)
    return {"utility": utility, "security": security, "model_turns": llm.turns,
            "calls": pipeline.calls, "asks": sum(c["outcome"] == "ask-principal" for c in pipeline.calls),
            "asks_approved": sum(c.get("principal") == "approved" for c in pipeline.calls),
            "attacker_call_proposed": proposed if proposed or pipeline.oracle_known else None,
            "attacker_call_executed": executed if executed or pipeline.oracle_known else None,
            "attacker_ground_truth": pipeline.initial_oracle,
            "termination": pipeline.termination, "status": "finished" if pipeline.termination == "final" else "failed",
            "final": pipeline.final, "errors": errors,
            "model_calls": llm.calls, "model_calls_made": sum(not c["cached"] for c in llm.calls),
            "model_calls_cached": sum(c["cached"] for c in llm.calls)}
