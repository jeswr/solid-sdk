// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { Store } from "n3";
import { importHealthExport, projectHealthFacts } from "../dist/index.js";

async function run(text, owner, sample) {
  const start = performance.now();
  const imported = await importHealthExport(text, { owner });
  sample?.();
  const view = projectHealthFacts(imported.value, { owner });
  const ms = performance.now() - start;
  sample?.();
  // Return numbers only, so timing-pass datasets cannot survive into profiling.
  return { nanopubs: imported.value.nanopubs.length, facts: view.facts.length, ms };
}

async function profile(text, owner) {
  let peak = 0;
  let samples = 0;
  let insertions = 0;
  let matches = 0;
  const sample = () => {
    global.gc();
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    samples++;
  };
  const addQuad = Store.prototype.addQuad;
  const match = Store.prototype.match;
  Store.prototype.addQuad = function (...args) {
    const result = Reflect.apply(addQuad, this, args);
    if (++insertions % 16_384 === 0) sample();
    return result;
  };
  Store.prototype.match = function (...args) {
    const result = Reflect.apply(match, this, args);
    if (++matches % 2500 === 0) sample();
    return result;
  };
  try {
    sample();
    await run(text, owner, sample);
    return { peakMB: Math.round((peak / 1024 ** 2) * 10) / 10, heapSamples: samples };
  } finally {
    Store.prototype.addQuad = addQuad;
    Store.prototype.match = match;
  }
}

if (!process.argv[2] || !global.gc) {
  console.error("Usage: node --expose-gc scripts/bench-import.mjs <file>");
  process.exitCode = 1;
} else {
  try {
    const text = await readFile(process.argv[2], "utf8");
    // Read-only projection needs an explicit owner. Prefer a supplied WebID when
    // benchmarking arbitrary exports; the fixture's owner is entirely fictional.
    const owner = process.env.PKG_BENCH_OWNER ?? "https://example.org/people/avery#me";
    global.gc();
    const timing = await run(text, owner);
    const heap = await profile(text, owner);
    console.log(
      JSON.stringify({
        ...timing,
        ms: Math.round(timing.ms),
        ...heap,
        heapMeasurement: "heapUsed after GC during insertion/graph reads; separate profiling pass",
      }),
    );
  } catch {
    // Parser diagnostics and file paths can contain private values.
    console.error("Health export benchmark failed");
    process.exitCode = 1;
  }
}
