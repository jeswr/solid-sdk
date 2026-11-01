// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { DatasetCore, NamedNode } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { fixtureFetch } from "../core/testing.js";
import type { NormalisedDoc } from "../core/types.js";
import { googleCalendarAdapter } from "./adapter.js";
import { EVENTS } from "./fixtures.js";
import { SCHED } from "./vocab-map.js";

const vocabRoot = new URL("../../../solid-federation-vocab/", import.meta.url);
// Reuse the ontology package's existing validator dependency without adding a connector dependency.
const vocabRequire = createRequire(new URL("package.json", vocabRoot));
const { default: SHACLValidator } = await import(
  pathToFileURL(vocabRequire.resolve("rdf-validate-shacl")).href
);
const shapes = new Store(
  new Parser().parse(
    await readFile(new URL("sectors/scheduling/scheduling.shacl.ttl", vocabRoot), "utf8"),
  ),
);

async function expectSchedulingConformance(data: DatasetCore) {
  const report = await new SHACLValidator(shapes).validate(data);
  // Organizer mapping is outside CON-04. All other results, including Info-level datatype
  // findings, fail this test; do not rely on a violation-only conforms flag.
  const unexpected = report.results.filter(
    (result: { path?: NamedNode; severity: NamedNode }) =>
      result.path?.value !== `${SCHED}organizer` ||
      result.severity.value !== "http://www.w3.org/ns/shacl#Warning",
  );
  expect(
    unexpected.map((result: { path?: NamedNode; severity: NamedNode }) => ({
      path: result.path?.value,
      severity: result.severity.value,
    })),
  ).toEqual([]);
}

describe("Google Calendar scheduling profile", () => {
  it("validates the committed mapping snapshot against the repository shapes", async () => {
    const data = new Store(
      new Parser().parse(
        await readFile(new URL("__snapshots__/mapping.ttl", import.meta.url), "utf8"),
      ),
    );
    await expectSchedulingConformance(data);
    // VOC-01 declares count's range in the ontology; its sidecar has no count constraint yet.
    for (const predicate of ["interval", "count"]) {
      const values = data.getQuads(null, DataFactory.namedNode(`${SCHED}${predicate}`), null, null);
      expect(values).toHaveLength(1);
      expect(values[0].object).toMatchObject({
        datatype: { value: "http://www.w3.org/2001/XMLSchema#positiveInteger" },
      });
    }
  });

  it("keeps cancellation responses conformant after the runner's vocabulary mapping", async () => {
    let written: NormalisedDoc | undefined;
    const master = EVENTS.items[0];
    const outcome = await googleCalendarAdapter.import({
      api: fixtureFetch("google-calendar", [
        {
          url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          json: {
            items: [
              {
                id: "cancelled",
                status: "cancelled",
                recurringEventId: master.id,
                originalStartTime: master.start,
              },
              master,
            ],
            nextSyncToken: "synthetic",
          },
        },
      ]),
      resolve: () => "https://pod.test/calendar/events.ttl",
      read: async () => undefined,
      progress: () => {},
      write: async (doc) => {
        written = googleCalendarAdapter.vocabMap?.(doc) ?? doc;
        return {
          url: "https://pod.test/calendar/events.ttl",
          category: doc.category,
          forClass: doc.forClass,
        };
      },
    });
    expect(outcome.skipped).toBeUndefined();
    expect(written).toBeDefined();
    if (!written) throw new Error("No Calendar document written");
    expect([...written.dataset].some((q) => q.subject.value.endsWith("#event-cancelled"))).toBe(
      false,
    );
    await expectSchedulingConformance(written.dataset);
  });
});
