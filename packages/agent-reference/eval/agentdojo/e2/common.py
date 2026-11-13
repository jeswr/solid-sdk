# AUTHORED-BY Codex GPT-6
"""Shared paths, lock verification, and durable JSON without host metadata."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
E1_ROOT = ROOT.parent
AUTHOR = "Codex GPT-6"
# translation and run.py are reused byte-for-byte, never regenerated.
sys.path.insert(0, str(E1_ROOT))
from translation import verify_lock

MANDATE_LOCK = verify_lock()  # before any transitive AgentDojo import


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(canonical(value) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def e1_module():
    verify_lock()
    name = "_agentdojo_e1_replay"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, E1_ROOT / "run.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]
