# AUTHORED-BY Codex GPT-6
"""Real Python -> Node stdio test (the same boundary used in measured replays)."""
import json
import subprocess

from translation import ROOT, verify_lock


def test_real_node_jsonl_and_failed_record(tmp_path):
    verify_lock()
    mandate = json.loads((ROOT / "mandates/standing/banking.json").read_text())
    request = {"mandate": mandate, "call": {"tool": "get_balance", "args": {}},
               "recipients": [], "amounts": [], "freeText": False, "context": [], "maxPayment": 0}
    script = ROOT.parent.parent / "dist/eval/bridge.js"
    journal = tmp_path / "record.jsonl"
    process = subprocess.run(["/opt/node24/bin/node", str(script), str(journal)],
                             input=json.dumps(request) + "\ninvalid\n" + json.dumps(request) + "\n",
                             capture_output=True, text=True, check=True)
    results = [json.loads(line) for line in process.stdout.splitlines()]
    assert [r["outcome"] for r in results] == ["go", "stop", "go"]
    assert results[1]["reason"] == "malformed"
    assert len(journal.read_text().splitlines()) == 2
    process = subprocess.run(["/opt/node24/bin/node", str(script), str(tmp_path / "missing/record.jsonl")],
                             input=json.dumps(request) + "\n", capture_output=True, text=True, check=True)
    assert json.loads(process.stdout)["reason"] == "record-unavailable"
