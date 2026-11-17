// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { DataFactory } from "n3";
import { ValidationWorkerPool, validateIntent } from "../../dist/index.js";

// heap.mjs: both quad-count caps, named graphs, and nearly 4 Mi shape term
// characters. Native allocation failures remain confined to this child.
const { namedNode, quad, literal } = DataFactory;
const fill = (count, prefix) =>
  Array.from({ length: count }, (_, index) => {
    const iri = (role) => namedNode(`urn:${prefix}:${role}:${index}:`.padEnd(90, "y"));
    return quad(iri("s"), iri("p"), literal("é".repeat(100)), iri("g"));
  });
const data = fill(1000, "data");
const shapes = fill(10000, "shape");
let worker;
const pool = new ValidationWorkerPool({
  size: 1,
  workerFactory: (url, options) => {
    worker = new Worker(url, options);
    return worker;
  },
});
try {
  assert.equal(
    (await validateIntent([], [], { workerPool: pool, timeoutMs: 10_000 })).conforms,
    true,
  );
  let peak = 0;
  let sampling = Promise.resolve();
  const sample = () => {
    sampling = sampling.then(async () => {
      peak = Math.max(peak, (await worker.getHeapStatistics()).used_heap_size);
    });
  };
  const timer = setInterval(sample, 10);
  let report;
  try {
    sample();
    report = await validateIntent(data, shapes, { workerPool: pool, timeoutMs: 15_000 });
    worker.ref();
    clearInterval(timer);
    sample();
    await sampling;
  } finally {
    clearInterval(timer);
  }
  assert.doesNotMatch(report.results[0]?.message ?? "", /worker|total characters|wall-clock/i);
  assert.ok(peak > 0 && peak < 384 * 1024 ** 2, `sampled worker heap ${peak} bytes`);
} finally {
  await pool.close();
}
