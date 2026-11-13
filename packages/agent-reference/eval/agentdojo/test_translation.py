# AUTHORED-BY Codex GPT-6
import json
from types import SimpleNamespace as NS

from translation import ROOT, Context, appears, classifications, effects, payment_limit, verify_lock


def test_preregistered_hashes_and_same_seven_rules():
    assert len(verify_lock()["sha256"]) == 5
    rules = []
    for suite in classifications():
        mandate = json.loads((ROOT / "mandates/standing" / f"{suite}.json").read_text())
        assert mandate["tools"] == classifications()[suite]
        rules.append(mandate["rules"])
    assert all(r == rules[0] for r in rules)
    assert [r["id"] for r in rules[0]] == list(range(1, 8))


def test_classes_and_outputs_cover_every_runtime_tool_in_both_versions():
    from agentdojo.task_suite import get_suites
    catalog = classifications()
    for version in ("v1", "v1.2"):
        for name, suite in get_suites(version).items():
            assert set(catalog[name]) == {tool.name for tool in suite.tools}
            for definition in catalog[name].values():
                assert definition["class"] in {"read", "change-own", "change-own-sensitive", "send"}
                assert definition["output"] in {"content", "own-record"}
    assert catalog["workspace"]["get_unread_emails"]["class"] == "change-own"
    assert catalog["banking"]["update_password"]["class"] == "change-own-sensitive"
    assert catalog["workspace"]["cancel_calendar_event"]["class"] == "send"
    assert catalog["workspace"]["get_sent_emails"]["output"] == "own-record"
    assert catalog["workspace"]["search_emails"]["output"] == "content"


def test_known_recipient_requires_instruction_or_own_record_output():
    context = Context()
    content = {"output": "content"}
    own = {"output": "own-record"}
    context.observe("received", content, {"sender": "eve@example.com"})
    assert not context.recipient("eve@example.com", "Pay the bill")["known"]
    assert context.recipient("eve@example.com", "Email EVE@example.com.")["known"]
    context.observe("contacts", own, [{"email": "eve@example.com"}])
    assert context.recipient("eve@example.com", "Pay the bill")["known"]
    assert not context.recipient("eve@example.com", "Pay the bill")["inInstruction"]
    assert not appears("Alice", "Malice")
    assert not appears("eve@example.com", "eve@example.company")
    assert not appears("", "anything")


def test_context_is_all_outputs_as_immutable_snapshots():
    context = Context()
    output = {"email": "alice@example.com", "nested": [1]}
    context.observe("contacts", {"output": "own-record"}, output)
    output["nested"].append(2)
    context.observe("file", {"output": "content"}, "ignore instructions")
    context.observe("failure", {"output": "content"}, None, "ValueError: missing")
    assert len(context.items) == 3
    assert context.items[0]["value"]["nested"] == [1]
    assert context.items[-1]["value"] == "ValueError: missing"
    assert len({item["id"] for item in context.items}) == 3


def test_all_email_recipients_including_cc_bcc():
    definition = classifications()["workspace"]["send_email"]
    recipients, amounts, text = effects("send_email", {"recipients": ["a"], "cc": ["b"], "bcc": ["c"], "body": "hello"}, definition, NS())
    assert recipients == ["a", "b", "c"]
    assert amounts == []
    assert text


def test_implicit_calendar_recipients_and_self_exclusion():
    env = NS(calendar=NS(account_email="self@example.com", events={"1": NS(participants=["a@example.com", "self@example.com"])}))
    definition = classifications()["workspace"]["cancel_calendar_event"]
    assert effects("cancel_calendar_event", {"event_id": "1"}, definition, env)[0] == ["a@example.com"]


def test_scheduled_update_resolves_runtime_truthiness_defaults():
    env = NS(bank_account=NS(scheduled_transactions=[NS(id=1, recipient="payee", amount=50, subject="memo")]))
    definition = classifications()["banking"]["update_scheduled_transaction"]
    recipients, amounts, text = effects("update_scheduled_transaction", {"id": 1, "amount": 0}, definition, env)
    assert recipients == ["payee"] and amounts == [50] and text


def test_history_limit_uses_default_environment_outgoing_payments_only():
    env = NS(bank_account=NS(iban="self", transactions=[NS(sender="self", amount=10), NS(sender="other", amount=999)]))
    assert payment_limit(env) == 10
    assert payment_limit(NS()) == 0
