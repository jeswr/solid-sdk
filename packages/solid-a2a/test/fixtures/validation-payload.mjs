// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { DataFactory } from "n3";
import { buildShapeForIntent, ValidationWorkerPool, validateIntent } from "../../dist/index.js";

// bench6: every term and the raw shape count satisfy the original individual caps.
// Keep the native worker in a child: a fatal V8 allocation must fail this test, not Vitest.
const { namedNode, quad, literal } = DataFactory;
const big = "x".repeat(4000);
let shapes = Array.from({ length: Number(process.argv[2]) }, (_, index) =>
  quad(
    namedNode(`urn:${index}:${big}`),
    namedNode(`urn:p:${big}`),
    literal(big),
    namedNode(`urn:g:${big}`),
  ),
);
let data;
if (process.argv[2] === "escaped") {
  // N3 escapes each NUL into six wire characters. Exercise worker headroom, not
  // just the refusal path, with both budgets nearly full at the same time.
  const fill = (budget, prefix) => {
    const quads = [];
    let characters = 0;
    for (let index = 0; ; index += 1) {
      const subject = namedNode(`urn:${prefix}:${index}`);
      const predicate = namedNode("urn:p");
      const object = literal("\u0000".repeat(4000));
      const graph = namedNode("urn:g");
      const length =
        subject.value.length +
        predicate.value.length +
        object.value.length +
        object.datatype.value.length +
        graph.value.length;
      if (characters + length > budget) break;
      quads.push(quad(subject, predicate, object, graph));
      characters += length;
    }
    assert.ok(characters > budget - 4096);
    return quads;
  };
  data = fill(1_048_576, "data");
  shapes = fill(4_194_304, "shapes");
}
const intent = { id: "urn:payload", action: "read", target: "https://a/x" };
const pool = new ValidationWorkerPool({ size: 1 });
try {
  assert.equal(
    (
      await validateIntent(intent, buildShapeForIntent("read"), {
        workerPool: pool,
        timeoutMs: 10000,
      })
    ).conforms,
    true,
  );
  const started = performance.now();
  const report = await validateIntent(data ?? intent, shapes, {
    workerPool: pool,
    timeoutMs: 10000,
  });
  if (data) {
    // Irrelevant shapes may conform or exhaust the operation budget. Neither
    // worker failure nor caller-side character refusal is an acceptable result.
    assert.equal(typeof report.conforms, "boolean");
    assert.doesNotMatch(report.results[0]?.message ?? "", /worker|total characters|wall-clock/i);
  } else {
    assert.equal(report.conforms, false);
    assert.match(report.results[0]?.message ?? "", /total characters/);
    // The caller must reject before the old 0.4–0.9 s JSON encoding stall.
    assert.ok(performance.now() - started < 250, "caller preflight stalled");
  }
} finally {
  await pool.close();
}
