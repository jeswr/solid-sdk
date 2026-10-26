// Run after building: pnpm --filter @jeswr/rdf-engine run bench:parse
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { Parser, Store } from "n3";
import { createRdfEngine } from "../dist/node.js";

function fixture(bytes: number) {
  const lines = ["@prefix ex: <https://example.org/> .\n"];
  let length = lines[0].length;
  let quads = 0;
  for (;;) {
    const line = `ex:s${quads} ex:name "Person ${quads}" ; ex:knows ex:s${quads + 1} .\n`;
    if (length + line.length > bytes - 2) break;
    lines.push(line);
    length += line.length;
    quads += 1;
  }
  lines.push(`#${" ".repeat(bytes - length - 2)}\n`);
  const text = lines.join("");
  assert.equal(Buffer.byteLength(text), bytes);
  return { text, quads: quads * 2 };
}
function stats(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    samplesMs,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

const engine = createRdfEngine();
const initialized = performance.now();
await engine.ready();
const initializationMs = performance.now() - initialized;
const results = [];
try {
  for (const bytes of [1024, 100 * 1024, 10 * 1024 * 1024]) {
    const { text, quads } = fixture(bytes);
    const parse = {
      n3: () => new Store(new Parser({ format: "text/turtle" }).parse(text)),
      sparq: () => engine.parse(text, "text/turtle"),
    };
    // Assert output correctness and warm both parsers before timing.
    for (let i = 0; i < 3; i++) {
      for (const method of ["n3", "sparq"] as const) {
        assert.equal((await parse[method]()).size, quads);
      }
    }
    const samples = { n3: [] as number[], sparq: [] as number[] };
    const iterations = bytes === 10 * 1024 * 1024 ? 7 : 21;
    for (let i = 0; i < iterations; i++) {
      // Alternate order to reduce systematic GC/JIT ordering bias.
      const order = i % 2 === 0 ? (["n3", "sparq"] as const) : (["sparq", "n3"] as const);
      for (const method of order) {
        const start = performance.now();
        const data = await parse[method]();
        samples[method].push(performance.now() - start);
        assert.equal(data.size, quads);
      }
    }
    const row = {
      bytes,
      quads,
      sha256: createHash("sha256").update(text).digest("hex"),
      n3: stats(samples.n3),
      sparq: stats(samples.sparq),
    };
    results.push(row);
    console.log(
      `${bytes} B: n3 ${row.n3.medianMs.toFixed(3)} ms; sparq ${row.sparq.medianMs.toFixed(3)} ms`,
    );
  }
} finally {
  engine.dispose();
}
const record = {
  authoredBy: "Codex GPT-6",
  measuredAt: new Date().toISOString(),
  machine: {
    node: process.version,
    v8: process.versions.v8,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  versions: { n3: "2.0.3", sparq: "0.1.5" },
  methodology:
    "String Turtle to materialized RDF/JS dataset: n3 Parser + Store vs rdf-engine/node parse (Sparq WASM + query/JSON/RDFJS materialization and free). Three warmups each; alternating order; 21 samples at 1/100 KiB, seven at 10 MiB; wall clock, GC enabled, no network or disk in timed sections. Fresh-process lazy WASM initialization reported separately (module import + instantiation); application module loading and network download excluded.",
  initializationMs,
  results,
  crossoverBytes: results.find((row) => row.sparq.medianMs < row.n3.medianMs)?.bytes ?? null,
};
await writeFile(new URL("./parse.json", import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
