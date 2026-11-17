// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { DataFactory } from "n3";
import { ValidationWorkerPool, validateIntent } from "../../dist/index.js";

const { namedNode, quad, literal } = DataFactory;
const concurrency = Number(process.argv[2]);
const readiness = [];
const workers = [];
const pool = new ValidationWorkerPool({
  size: concurrency,
  workerFactory: (url, options) => {
    const worker = new Worker(url, options);
    workers.push(worker);
    readiness.push(new Promise((resolve) => worker.once("message", resolve)));
    return worker;
  },
});
const fill = (count, prefix) =>
  Array.from({ length: count }, (_, index) =>
    quad(namedNode(`urn:${prefix}:${index}`), namedNode("urn:p"), literal("\u0001".repeat(4000))),
  );
const shapes = fill(1030, "shape");
const data = fill(250, "data");
try {
  assert.equal(
    (await validateIntent([], [], { workerPool: pool, timeoutMs: 10_000 })).conforms,
    true,
  );
  // Isolate caller preflight/encoding from native module warm-up on other slots.
  for (const worker of workers) worker.ref();
  try {
    await Promise.all(readiness);
  } finally {
    for (const worker of workers) worker.unref();
  }
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 5);
  let reports;
  try {
    reports = await Promise.all(
      Array.from({ length: concurrency }, () =>
        validateIntent(data, shapes, { workerPool: pool, timeoutMs: 10_000 }),
      ),
    );
    // Sample once more even when refusal settles before the first timer tick.
    await delay(10);
  } finally {
    clearInterval(timer);
  }
  assert.ok(maxGap < 250, `caller loop gap ${Math.round(maxGap)} ms exceeds 250 ms`);
  for (const report of reports) {
    assert.equal(report.conforms, false);
    assert.match(report.results[0]?.message ?? "", /total characters/);
  }
} finally {
  await pool.close();
}
