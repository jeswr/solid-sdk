# AUTHORED-BY Claude Opus 5.5
"""Exercise the actual 1.2.3 public types/HAR parser without importing its optional evaluator stack.

python3 test/check-reference.py /path/to/reference /path/to/submission
Requires the reference's existing pydantic dependency; never alters the reference files.
"""

import ast
import json
import sys
import types
from pathlib import Path


class LocalImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        # Resolve the cycle in one local namespace, avoiding package __init__ (which loads
        # jsonpath-ng, geopy, pint, etc.). All parser/model implementations remain original.
        if node.module and node.module.startswith("webarena_verified."):
            return ast.copy_location(ast.Pass(), node)
        return node


def main():
    reference = Path(sys.argv[1]) / "webarena_verified"
    submission = Path(sys.argv[2])
    module = types.ModuleType("webarena_contract")
    sys.modules[module.__name__] = module
    for path in [
        reference / "core/utils/network_event_utils.py",
        reference / "types/tracing.py",
        reference / "types/agent_response.py",
    ]:
        tree = ast.fix_missing_locations(LocalImports().visit(ast.parse(path.read_text())))
        exec(compile(tree, str(path), "exec"), module.__dict__)

    count = 0
    for directory in sorted(submission.iterdir()):
        if not directory.is_dir() or not directory.name.isdigit():
            continue
        response = module.FinalAgentResponse.model_validate_json((directory / "agent_response.json").read_text())
        trace = module.NetworkTrace.from_har(directory / "network.har")
        assert trace.events
        for event in trace.events:
            # Touch every field/property consumed by NetworkEventEvaluator, not just loader shape.
            assert event.url and event.http_method
            _ = (event.url_path, event.referer, event.post_data, event.response_content,
                 event.request_status, event.redirect_url, event.is_redirect,
                 event.is_request_success, event.request_headers, event.response_headers,
                 event.response_cookies, event.is_evaluation_event, event.is_navigation_event)
        if response.is_navigate and response.status == "SUCCESS":
            assert trace.events[-1].is_navigation_event
        count += 1
    assert count
    print(json.dumps({"validated_submissions": count, "reference": "1.2.3 public types and HAR parser"}))


if __name__ == "__main__":
    main()
