# AUTHORED-BY Codex GPT-6
"""Trusted benchmark-to-bridge translation; no authorization decisions live here."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def json_value(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def verify_lock():
    lock = json.loads((ROOT / "MANDATES.lock").read_text())
    for name, expected in lock["sha256"].items():
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(f"Preregistered file changed: {name}")
    return lock


def classifications():
    verify_lock()
    return json.loads((ROOT / "tool-classification.json").read_text())["suites"]


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def appears(recipient, value):
    """Literal, case-insensitive identifier occurrence, with word/email boundaries."""
    if not recipient:
        return False
    pattern = re.compile(r"(?<![\w@+.-])" + re.escape(recipient) + r"(?![\w@+-])", re.IGNORECASE)
    return any(pattern.search(s) is not None for s in strings(value))


class Context:
    def __init__(self):
        self.items = []

    def observe(self, tool, definition, output, error=None):
        # Snapshot: later environment mutations must not rewrite what entered context.
        value = json.loads(json.dumps(json_value(output if error is None else error)))
        self.items.append({"id": f"context:{len(self.items)}:{tool}", "label": definition["output"], "value": value})

    def recipient(self, recipient, prompt):
        in_instruction = appears(recipient, prompt)
        return {
            "value": recipient,
            "inInstruction": in_instruction,
            "known": in_instruction or any(item["label"] == "own-record" and appears(recipient, item["value"]) for item in self.items),
        }


def effects(tool, args, definition, environment):
    """Resolve actual recipients and defaulted amounts without executing any tool."""
    args = json_value(args)
    if "implicit_defaults" in definition:
        transaction = next((t for t in environment.bank_account.scheduled_transactions if t.id == args["id"]), None)
        if transaction is not None:
            for field in ("recipient", "amount", "subject"):
                # AgentDojo's updater uses truthiness, not an explicit None check.
                if not args.get(field):
                    args[field] = getattr(transaction, field)
    recipients = []
    for field in definition["recipient_args"]:
        value = args.get(field)
        if value is not None:
            recipients.extend(value if isinstance(value, list) else [value])
    if "implicit_recipients" in definition:
        event = environment.calendar.events.get(args["event_id"])
        if event is not None:
            recipients.extend(event.participants)
    if hasattr(environment, "calendar") and ("implicit_recipients" in definition or "self_recipient" in definition):
        recipients = [r for r in recipients if str(r).lower() != str(environment.calendar.account_email).lower()]
    recipients = sorted(set(str(r) for r in recipients))
    amounts = [args[field] for field in definition["amount_args"] if args.get(field) is not None]
    free_text = any(isinstance(args.get(field), str) and bool(args[field]) for field in definition["content_args"])
    return recipients, amounts, free_text


def payment_limit(environment):
    if not hasattr(environment, "bank_account"):
        return 0
    bank = environment.bank_account
    return max((t.amount for t in bank.transactions if t.sender == bank.iban), default=0)


def request_for(call, definition, environment, context, prompt, mandate, max_payment):
    recipients, amounts, free_text = effects(call.function, call.args, definition, environment)
    return {
        "mandate": mandate,
        "call": {"tool": call.function, "args": json_value(call.args)},
        "recipients": [context.recipient(r, prompt) for r in recipients],
        "amounts": amounts,
        "freeText": free_text,
        "context": context.items,
        "maxPayment": max_payment,
    }
