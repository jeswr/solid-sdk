// AUTHORED-BY Codex GPT-6.2 Sol
import { parseRdf } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { spawnSync } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import type { PathResult } from "../src/engine/run.js";
import { traceFileSchema, traceFileSchemaWithLinkedTable } from "../src/trace/schema.js";
import { outlineOf, type TraceFile, type TraceLinkedView } from "../src/trace/types.js";
import { storeDocumentLoader } from "../src/wire/store-contexts.js";

const root = new URL("../", import.meta.url);
const committed = (stem: string, configuration: string): TraceFile & { "x-authored-by": string } =>
  JSON.parse(readFileSync(new URL(`traces/${stem}--${configuration}.json`, root), "utf8"));

function withoutLinked(trace: TraceFile): TraceFile {
  const { linked: _table, linkedTable: _reference, events, ...rest } = trace;
  return { ...rest, events: events.map(({ linked: _keys, ...event }) => event) };
}

function run(scenario: string, mode: "plain" | "linked", configuration: string) {
  const directory = mkdtempSync(join(tmpdir(), "trace-linked-"));
  const file = join(directory, "trace.json");
  const log = join(directory, "run.log");
  try {
    const fd = openSync(log, "w");
    let child: ReturnType<typeof spawnSync>;
    try {
      child = spawnSync(
        process.execPath,
        ["test/helpers/trace-linked-run.mjs", scenario, file, mode, configuration],
        {
          cwd: root,
          stdio: ["ignore", fd, fd],
        },
      );
    } finally {
      closeSync(fd);
    }
    if (child.status !== 0 || child.error)
      throw new Error(`Scenario run failed: ${child.error ?? readFileSync(log, "utf8")}`);
    const paths: PathResult[] = JSON.parse(readFileSync(file, "utf8"));
    const written = new Map<string, string>();
    for (const { path, trace } of paths) {
      if (trace)
        written.set(
          path,
          readFileSync(
            join(directory, "traces", `${trace.scenario.id}--${configuration}.json`),
            "utf8",
          ),
        );
    }
    const reference = `linked/${scenario}.json`;
    const table: Record<string, TraceLinkedView> | undefined =
      mode === "linked"
        ? JSON.parse(readFileSync(join(directory, "traces", reference), "utf8"))
        : undefined;
    return { paths, written, reference, table };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const bytes = (trace: TraceFile) => digestBytes(`${JSON.stringify(trace, null, 2)}\n`);

for (const [scenario, configuration] of [
  ["age-check", "baseline"],
  ["mortgage-core", "baseline"],
  ["mortgage-core", "authenticity-data-integrity"],
] as const) {
  it(`adds valid store views to ${scenario} (${configuration}) with the switch and preserves trace bytes`, async () => {
    const baseline = committed(scenario, configuration);
    const linked = run(scenario, "linked", configuration);
    const plainRun = run(scenario, "plain", configuration);
    const categories = new Set<string>();
    const sharedKeys = new Set<string>();
    const sharedSchema = traceFileSchemaWithLinkedTable((reference) =>
      reference === linked.reference ? linked.table : undefined,
    );
    for (const [index, path] of linked.paths.entries()) {
      const trace = path.trace;
      const plain = plainRun.paths[index]?.trace;
      if (path.blocked?.includes("sparq-zk-result/5") && scenario === "age-check") {
        expect(path.path).toBe("main");
        expect(plain).toBeUndefined();
        continue;
      }
      if (!trace?.linked || !plain) throw new Error(`Missing trace for ${path.path}`);
      expect(traceFileSchema.safeParse(trace).success).toBe(true);
      const sharedBytes = linked.written.get(path.path);
      if (!sharedBytes) throw new Error(`Missing shared trace for ${path.path}`);
      const shared: TraceFile = JSON.parse(sharedBytes);
      expect(shared.linkedTable).toBe(linked.reference);
      expect(shared.linked).toBeUndefined();
      expect(shared.events).toEqual(trace.events);
      expect(sharedSchema.safeParse(shared).success).toBe(true);
      expect(bytes(withoutLinked(shared))).toBe(bytes(plain));
      expect(plainRun.written.get(path.path)).toBe(`${JSON.stringify(plain, null, 2)}\n`);
      const views = trace.linked;
      for (const event of trace.events) {
        const kinds = event.linked?.map((key) => views[key]?.what) ?? [];
        for (const kind of kinds) if (kind) categories.add(kind);
        if (event.kind === "store" || event.kind === "recall")
          expect(kinds, event.caption).toContain("memory-item");
        if (event.kind === "decision" || (event.kind === "record" && event.part === "record"))
          expect(kinds, event.caption).toContain("record-entry");
        if (
          event.kind === "check" &&
          /^(urn:terms:|urn:awp:rule:)|#terms\//.test(event.rule?.id ?? "")
        )
          expect(kinds, event.caption).toContain("policy");
        if (
          event.resolution &&
          (event.rule?.id.includes("urn:source:") ||
            event.rule?.id.includes("sector-register/") ||
            event.rule?.id.includes("#rule/"))
        )
          expect(kinds, event.caption).toContain("trust-entry");
        if (
          event.check === "recipient" &&
          event.verdict === "pass" &&
          event.resolution?.path.length === 1 &&
          event.resolution.path[0]?.kind === "own-list"
        )
          expect(kinds, event.caption).toContain("trust-entry");
        if (event.kind === "check") expect(kinds).not.toContain("record-entry");
      }
      const keys = trace.events.flatMap((event) => event.linked ?? []);
      for (const key of keys) sharedKeys.add(key);
      expect(new Set(keys)).toEqual(new Set(Object.keys(views)));
      for (const [key, view] of Object.entries(views)) {
        expect(key).toBe(digestBytes(view.jsonld));
        expect(JSON.parse(view.jsonld)["@context"]).toEqual(view.context);
        expect(linked.table?.[key]?.jsonld).toBe(view.jsonld);
        const json = await parseRdf(view.jsonld, "application/ld+json", {
          documentLoader: storeDocumentLoader,
        });
        const turtle = await parseRdf(view.turtle, "text/turtle");
        expect(json.size, key).toBeGreaterThan(0);
        expect(json.size, key).toBe(turtle.size);
        for (const quad of json) {
          expect(quad.graph.termType).toBe("DefaultGraph");
          expect(quad.subject.termType).toBe("NamedNode");
          expect(quad.object.termType).not.toBe("BlankNode");
          expect(turtle.has(quad), key).toBe(true);
        }
      }
      expect(Object.hasOwn(plain, "linked")).toBe(false);
      expect(plain.events.every((event) => !Object.hasOwn(event, "linked"))).toBe(true);
      expect(outlineOf(trace)).toEqual(outlineOf(plain));
      expect(bytes(withoutLinked(trace))).toBe(bytes(plain));
      const fixture =
        path.pathKind === "main" ? baseline : committed(`${scenario}--${path.path}`, configuration);
      const emitted = { "x-authored-by": fixture["x-authored-by"], ...plain };
      const expected = withoutLinked({
        ...fixture,
        generated: { ...fixture.generated, commit: baseline.generated.commit },
      });
      expect(bytes(emitted), `${scenario}/${path.path}`).toBe(bytes(expected));
    }
    expect(Object.keys(linked.table ?? {})).toEqual([...sharedKeys].sort());
    expect(categories).toEqual(new Set(["memory-item", "record-entry", "policy", "trust-entry"]));
  });
}
