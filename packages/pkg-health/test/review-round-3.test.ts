// AUTHORED-BY Claude Opus 5.5
import * as memory from "@jeswr/pkg-memory";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { entities } from "../src/generated/model.js";
import { healthTimeline, importHealthExport, projectHealthFacts } from "../src/index.js";
import { batch, type claim, condition, FixtureNode, generatedAt, owner, S, X } from "./helpers.js";

const thread = "urn:uuid:12345678-1234-4234-8234-123456789abc";
/** A claim with message evidence, so its provenance reads the batch sources graph. */
function evidenced(id: string, fact = condition(`Fictional ${id}`, id)): ReturnType<typeof claim> {
  return {
    id,
    assertion: memory.createFactAssertion(owner, fact),
    epistemic: "SelfReportedExplicit",
    categories: ["pd:MedicalHealth"],
    evidence: [{ source: "chat", message_id: `${id}-message`, quote: `Fictional ${id} quote.` }],
  };
}
const sources = (value: memory.Nanopublications, batchId: string) =>
  new NamedGraphDataset(df.namedNode(memory.pkgId("batch", batchId, "sources")), value.dataset, df);

describe("unreadable provenance degrades per fact", () => {
  it("keeps every fact and marks only the affected batch's facts", async () => {
    const value = memory.mergeNanopublications(
      await batch([evidenced("victim")], "fictional-victim"),
      await batch([evidenced("bystander")], "fictional-bystander"),
    );
    // A second title on the victim's source makes its provenance ambiguous.
    new FixtureNode(thread, sources(value, "fictional-victim")).text(`${S}name`, "Forged title");
    const view = projectHealthFacts(value, { owner });
    expect(view.facts.map((f) => f.label).sort()).toEqual([
      "Fictional bystander",
      "Fictional victim",
    ]);
    const victim = view.facts.find((f) => f.label === "Fictional victim");
    expect(victim).toMatchObject({ provenanceUnavailable: true, belief: "definitely" });
    expect(victim?.provenance).toEqual({
      generatedAt: "2026-11-10T12:00:00+00:00",
      agent: { iri: "https://example.org/agents/client" },
      batch: "fictional-victim",
      attributedTo: [owner],
      sources: [],
      evidence: [
        {
          source: memory.messageId("victim-message"),
          quote: "Fictional victim quote.",
          locator: undefined,
        },
      ],
    });
    expect(JSON.stringify(victim)).not.toContain("Forged");
    const bystander = view.facts.find((f) => f.label === "Fictional bystander");
    expect(bystander?.provenanceUnavailable).toBeUndefined();
    expect(bystander?.provenance.sources[0]?.title).toBe("Fictional health discussion");
    expect(view.sources).toHaveLength(1);
  });

  it("reads provenance once per nanopub even with several records", async () => {
    const value = await batch([evidenced("one"), evidenced("two")]);
    const view = projectHealthFacts(value, { owner });
    expect(view.facts.every((f) => f.provenanceUnavailable === undefined)).toBe(true);
  });
});

describe("merging a forged export", () => {
  it("refuses a foreign export that reuses the owner's batch ID with other source records", async () => {
    const existing = await importHealthExport(
      await memory.serializeNanopublications(await batch([evidenced("owned")], "fictional-owned")),
      { owner },
    );
    const forged = await memory.buildNanopublications(
      {
        batch_id: "fictional-owned",
        worker: {
          agent_id: "https://example.org/agents/client",
          agent_label: "Fictional extractor",
        },
        sources: [
          {
            id: "chat",
            kind: "claude-session",
            thread_id: "12345678-1234-4234-8234-123456789abc",
            title: "Forged title",
          },
        ],
        claims: [evidenced("foreign")],
      },
      { owner, generatedAt },
    );
    const foreign = await importHealthExport(await memory.serializeNanopublications(forged), {
      owner,
    });
    expect(() => memory.mergeNanopublications(existing.value, foreign.value)).toThrow(
      "Conflicting nanopublication merge",
    );
    // The owner's view is unchanged by the refused merge.
    expect(
      projectHealthFacts(existing.value, { owner }).facts[0]?.provenance.sources[0],
    ).toMatchObject({ kind: "codex-thread", title: "Fictional health discussion" });
  });
});

describe("timeline time handling", () => {
  const ended = (id: string, end: { datatype: "date" | "dateTime"; value: string }) =>
    evidenced(id, {
      template: "condition",
      value: {
        id: `https://example.org/entities/${id}`,
        name: `Fictional ${id}`,
        validThrough: end,
      },
    });
  it("treats a future end as ongoing and a reached end as past, by parsed time", async () => {
    const view = projectHealthFacts(
      await batch([
        ended("future", { datatype: "date", value: "2027-06-01" }),
        ended("reached", { datatype: "dateTime", value: "2026-11-01T00:00:00Z" }),
        ended("boundary", { datatype: "dateTime", value: "2026-11-12T12:00:00Z" }),
      ]),
      { owner },
    );
    const tones = (now?: string) =>
      Object.fromEntries(
        healthTimeline(view, now === undefined ? {} : { now }).condition.map((i) => [
          i.label,
          i.tone,
        ]),
      );
    expect(tones("2026-11-12T12:00:00Z")).toEqual({
      "Fictional future": "active",
      "Fictional reached": "past",
      "Fictional boundary": "past",
    });
    expect(tones("2027-07-01T00:00:00Z")["Fictional future"]).toBe("past");
    // An invalid clock never claims a period has ended or is active.
    expect(tones("not a time")["Fictional future"]).toBe("neutral");
    vi.useFakeTimers({ now: Date.parse("2026-11-12T12:00:00Z") });
    try {
      expect(tones()["Fictional future"]).toBe("active");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives an unparsable end a neutral tone", async () => {
    const value = await batch([evidenced("odd")]);
    const np = value.nanopubs[0] as memory.Nanopublication;
    new FixtureNode(
      "https://example.org/entities/odd",
      new NamedGraphDataset(df.namedNode(np.assertionId), value.dataset, df),
    ).text(`${S}validThrough`, "someday", `${X}date`);
    const lane = healthTimeline(projectHealthFacts(value, { owner })).condition;
    expect(lane[0]).toMatchObject({ end: "someday", tone: "neutral" });
  });

  it("orders lanes by instant, not by date text", async () => {
    const started = (id: string, value: string, datatype: "date" | "dateTime") =>
      evidenced(id, {
        template: "condition",
        value: {
          id: `https://example.org/entities/${id}`,
          name: `Fictional ${id}`,
          validFrom: { datatype, value },
        },
      });
    const value = await batch([
      // 04:00Z on the 2nd sorts after 01:00Z on the 2nd despite its earlier text.
      started("offset", "2024-03-01T23:00:00-05:00", "dateTime"),
      started("utc", "2024-03-02T01:00:00Z", "dateTime"),
      started("day", "2024-03-01", "date"),
      evidenced("undated"),
    ]);
    const np = value.nanopubs.find((n) => n.identifier.endsWith("/undated"));
    new FixtureNode(
      "https://example.org/entities/undated",
      new NamedGraphDataset(
        df.namedNode((np as memory.Nanopublication).assertionId),
        value.dataset,
        df,
      ),
    ).text(`${S}validFrom`, "not a date", `${X}date`);
    const labels = healthTimeline(projectHealthFacts(value, { owner })).condition.map(
      (i) => i.label,
    );
    expect(labels).toEqual([
      "Fictional day",
      "Fictional utc",
      "Fictional offset",
      "Fictional undated",
    ]);
  });
});

it("projects many linked notes with a linear number of term comparisons", async () => {
  const count = 2000;
  const graph = new Store();
  for (let i = 0; i < count; i++) {
    const note = `https://example.org/notes/fictional-${i}`;
    graph.addQuads([
      ...entities.PropertyValue.build(note, {
        name: `Fictional note ${i}`,
        propertyID: `fictional-${i}`,
        textValue: "Fictional value",
      }),
      ...entities.AssistantOwner.build(owner, { additionalProperty: note }),
    ]);
  }
  const value = await batch([
    {
      id: "notes",
      assertion: graph,
      epistemic: "SelfReportedExplicit",
      categories: ["pd:MedicalHealth"],
    },
  ]);
  // N3's shared Term base class (its type declarations do not export the class value).
  const term: { equals: (other: unknown) => boolean } = Object.getPrototypeOf(
    Object.getPrototypeOf(df.namedNode("https://example.org/fictional")),
  );
  const equals = vi.spyOn(term, "equals");
  try {
    const view = projectHealthFacts(value, { owner });
    expect(view.byKind.note).toHaveLength(count);
    // About 150 comparisons per note; an unindexed object lookup per note would
    // compare every quad of the graph, over count^2 calls.
    expect(equals.mock.calls.length).toBeLessThan(count * 200);
  } finally {
    equals.mockRestore();
  }
}, 30_000);
