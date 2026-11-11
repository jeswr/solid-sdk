// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { buildShapeForIntent, validateIntent } from "../../dist/index.js";

const intent = { id: "urn:package-test", action: "read", target: "https://a/x" };
const shape = buildShapeForIntent("read");
assert.deepEqual(await validateIntent(intent, shape), { conforms: true, results: [] });
assert.deepEqual(await validateIntent(intent, shape, { timeoutMs: 1 }), {
  conforms: false,
  results: [{ message: "Validation exceeded 1 ms wall-clock limit" }],
});
