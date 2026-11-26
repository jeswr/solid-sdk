// AUTHORED-BY Claude Opus 5.5
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Quad } from "@rdfjs/types";
import env from "@zazuko/env-node";
import { Parser, type Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildObservation, HEALTH, loincCode, UNITS } from "../src/index.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const SH = "http://www.w3.org/ns/shacl#";
const HSH = "https://jeswr.org/ns/sectors/health/import-shapes#";
const health = "https://jeswr.org/ns/sectors/health#";
const read = (path: string) => readFileSync(new URL(path, new URL("..", import.meta.url)), "utf8");
const parse = (turtle: string) => new Parser().parse(turtle);
const canonical = (quads: Quad[]) =>
  quads
    .map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.termType}:${q.object.value}`)
    .sort();

const subtypes = [
  { type: HEALTH.Steps, shape: "StepsShape", unit: UNITS.count, code: "55423-8", unitCode: "1" },
  { type: HEALTH.Sleep, shape: "SleepShape", unit: UNITS.seconds, code: "93832-4", unitCode: "s" },
  {
    type: HEALTH.HeartRate,
    shape: "HeartRateShape",
    unit: UNITS.pulse,
    code: "8867-4",
    unitCode: "/min",
  },
] as const;

let workdir: string;
let exported: Quad[];
beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), "solid-health-shacl-"));
  const output = join(workdir, "health.shacl.ttl");
  await promisify(execFile)("node", ["scripts/build-shacl.mjs", output], { cwd: packageDir });
  exported = parse(readFileSync(output, "utf8"));
});
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

async function validate(shapes: Quad[], data: Store | Quad[]) {
  return new SHACLValidator(env.dataset(shapes), { factory: env }).validate(env.dataset([...data]));
}

describe("exported health.shacl.ttl (sector conformance)", () => {
  it("is published from the composed build output", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.exports["./health.shacl.ttl"]).toBe("./dist/health.shacl.ttl");
    expect(pkg.scripts.build).toContain("node scripts/build-shacl.mjs");
    expect(pkg.files).toContain("dist");
  });

  it("is the generated shapes plus exactly the three subtype compositions", () => {
    const composition = parse(read("codegen/health.composition.ttl"));
    expect(canonical(composition)).toEqual(
      subtypes
        .map(({ shape }) => `${HSH}${shape} ${SH}node NamedNode:${HSH}ObservationShape`)
        .sort(),
    );
    expect(canonical(exported)).toEqual(
      canonical([...parse(read("src/generated/shapes.ttl")), ...composition]),
    );
  });

  it.each(subtypes)("rejects a $shape node carrying only its type and unit", async (subtype) => {
    const id = "https://pod.test/health/observations/x/2026-06.ttl#bare";
    const bare = parse(`<${id}> a <${subtype.type}> ; <${health}hasUnit> <${subtype.unit}> .`);
    // The generated shapes alone do not target the subtype with the Observation MUSTs.
    expect((await validate(parse(read("src/generated/shapes.ttl")), bare)).conforms).toBe(true);

    const report = await validate(exported, bare);
    expect(report.conforms).toBe(false);
    const paths = new Set(
      report.results
        .flatMap((result) => result.detail ?? [])
        .concat(report.results)
        .map((result) => result.path?.value),
    );
    for (const property of ["hasCode", "patient", "effectiveTime", "value", "unitCode"])
      expect(paths, property).toContain(`${health}${property}`);
  });

  it.each(subtypes)("accepts a $shape record written by buildObservation", async (subtype) => {
    const id = "https://pod.test/health/observations/x/2026-06.ttl#import-2026-06-01";
    const store = buildObservation(id, {
      type: subtype.type,
      ...loincCode(subtype.code),
      measuredValue: 42,
      unitCode: subtype.unitCode,
      dateTime: "2026-06-01T00:00:00Z",
    });
    const report = await validate(exported, store);
    expect(report.results.map((result) => result.message.map((m) => m.value))).toEqual([]);
    expect(report.conforms).toBe(true);
  });
});
