# AUTHORED-BY Codex GPT-6
"""Offline Codex-shaped executable, controlled entirely by a JSON script file."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import time


def argument(name):
    return sys.argv[sys.argv.index(name) + 1]


def main():
    script_path = Path(argument("--script"))
    script = json.loads(script_path.read_text())
    prompt = sys.stdin.read()
    state = script_path.with_suffix(".state")
    with state.open("a+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.seek(0)
        index = int(stream.read() or "0")
        stream.seek(0)
        stream.truncate()
        stream.write(str(index + 1))
    assert argument("-s") == "read-only"
    assert argument("-C") == str(Path.cwd())
    assert list(Path.cwd().iterdir()) == []
    assert "--skip-git-repo-check" in sys.argv
    assert sys.argv[-1] == "-"
    assert "no tools of your own" in prompt
    for text in script.get("contains", []):
        assert text in prompt
    for text in script.get("excludes", []):
        assert text not in prompt
    if script.get("fail_if_contains") and script["fail_if_contains"] in prompt:
        return 17
    if script.get("mode") == "one-tool":
        reply = json.dumps({"final": "done"}) if '"role":"tool"' in prompt else json.dumps({"tool_calls": [script["call"]]})
        step = {"reply": reply}
    else:
        steps = script["steps"]
        step = steps[min(index, len(steps) - 1)]
    for text in step.get("contains", []):
        assert text in prompt
    if step.get("spawn_child_marker"):
        subprocess.Popen([sys.executable, "-c", "import time,pathlib; time.sleep(0.5); pathlib.Path(__import__('sys').argv[1]).touch()", step["spawn_child_marker"]])
    if step.get("sleep"):
        time.sleep(step["sleep"])
    print("CLI LOG MUST NEVER BE CACHED")
    print("PRIVATE CLI STDERR MUST NEVER BE CACHED", file=sys.stderr)
    if step.get("exit"):
        return step["exit"]
    if not step.get("no_output"):
        Path(argument("--output-last-message")).write_bytes(step.get("reply", "").encode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
