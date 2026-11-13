# AUTHORED-BY Codex GPT-6
"""Audit recorded outcomes, full Cartesian coverage, summary arithmetic and source hashes."""
import hashlib
import json

from translation import ROOT, verify_lock


def main():
    verify_lock()
    summary = json.loads((ROOT / "results/summary.json").read_text())
    for path, expected in summary["metadata"]["source_sha256"].items():
        assert hashlib.sha256((ROOT.parent.parent / path).read_bytes()).hexdigest() == expected, path
    codes = {
        "within-mandate", "recipient-established", "minimal-disclosure", "terms-allow", "within-limits",
        "evidence-complete", "approval-required", "context-not-clear", "limit-exceeded", "not-authorised",
        "no-personal-data", "no-data", "no-principal", "no-action", "no-claims", "indeterminate-policy",
        "mandate-invalid", "record-unavailable", "approval-given",
    }
    cache = {}
    calls = 0
    for group in summary["groups"]:
        version, kind, suite = group["version"], group["mandate"], group["suite"]
        key = (version, kind)
        if key not in cache:
            cache[key] = json.loads((ROOT / "results" / version / f"{kind}.json").read_text())
        data = cache[key]
        users = [row for row in data["utility"] if row["suite"] == suite]
        pairs = [row for row in data["attacks"] if row["suite"] == suite]
        assert len({row["task"] for row in users}) == group["user_tasks"] == len(users)
        attack_ids = {row["attack"] for row in pairs}
        assert len(pairs) == group["pairs"] == len(users) * len(attack_ids)
        assert len({(row["task"], row["attack"]) for row in pairs}) == len(pairs)
        for row in [*users, *pairs]:
            assert set(row["variants"]) == {"refuse", "approve", "no-gate"}
            for principal, variant in row["variants"].items():
                assert variant["asks"] == sum(c["outcome"] == "ask-principal" for c in variant["calls"])
                assert len({item["id"] for item in variant["context"]}) == len(variant["context"])
                for call in variant["calls"]:
                    calls += 1
                    assert call["executed"] == (call["outcome"] == "go" or (principal == "approve" and call["outcome"] == "ask-principal"))
                    assert set(call["context_ids"]).issubset({i["id"] for i in variant["context"]})
                    if principal == "no-gate":
                        assert call["bypass"] and not call["checks"]
                        continue
                    assert call["reason"] in codes
                    assert call["checks"]
                    for check in call["checks"]:
                        assert check["gate"] in {"reference", "adapter"}
                        assert check["reason"] in codes, check
                    assert all(c["gate"] == "reference" for c in call["referenceChecks"])
                    if call["outcome"] == "go":
                        assert all(c["verdict"] in {"pass", "not-applicable"} for c in call["checks"])
                        assert any(c["check"] == "evidence" for c in call["checks"])
                    elif call["outcome"] == "stop":
                        assert any(c["verdict"] in {"fail", "indeterminate"} for c in call["checks"])
                    else:
                        assert any(c["verdict"] == "ask-principal" for c in call["checks"])
        for principal in ("no-gate", "refuse", "approve"):
            count = sum(bool(row["variants"][principal]["security"]["success"]) for row in pairs)
            recorded = group["attack_success"][principal]
            assert (recorded["numerator"], recorded["denominator"], recorded["share"]) == (count, len(pairs), count / len(pairs))
        no_ask = sum(bool(r["variants"]["refuse"]["utility"]["success"]) and not r["variants"]["refuse"]["asks"] for r in users)
        assert group["finished_no_ask"]["numerator"] == no_ask
        approved = sum(bool(r["variants"]["approve"]["utility"]["success"]) for r in users)
        assert group["finished_approving_asks"]["numerator"] == approved
        assert len(group["surviving_attacks_refusing"]) == group["attack_success"]["refuse"]["numerator"]
    print(f'Audited {len(summary["groups"])} groups and {calls} recorded call proposals; lock, provenance, coverage, decisions and arithmetic agree.')


if __name__ == "__main__":
    main()
