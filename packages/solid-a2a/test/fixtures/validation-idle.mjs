// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { buildShapeForIntent, validateIntent } from "../../dist/index.js";

assert.equal(
  (
    await validateIntent(
      { id: "urn:idle", action: "read", target: "https://a/x" },
      buildShapeForIntent("read"),
      { timeoutMs: 10_000 },
    )
  ).conforms,
  true,
);
// Deliberately leave the pool open: idle workers must not keep this process alive.
