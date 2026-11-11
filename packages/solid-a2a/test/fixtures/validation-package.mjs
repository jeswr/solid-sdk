// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { buildShapeForIntent, closeValidationPool, validateIntent } from "../../dist/index.js";

const intent = { id: "urn:package-test", action: "read", target: "https://a/x" };
const shape = buildShapeForIntent("read");
assert.deepEqual(await validateIntent(intent, shape), { conforms: true, results: [] });
await closeValidationPool();
assert.deepEqual(await validateIntent(intent, shape, { timeoutMs: 1 }), {
  conforms: false,
  results: [{ message: "Validation exceeded 1 ms wall-clock limit" }],
});
await closeValidationPool();
