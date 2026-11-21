// AUTHORED-BY Codex GPT-6.1-Sol
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df } from "n3";
import { expect, it } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  type Nanopublications,
  NanopubStore,
  parseNanopublications,
  pkgId,
  readNanopubProvenance,
  serializeNanopublications,
} from "../src/index.js";
import { NS, RdfNode } from "../src/rdf.js";
import { createMemoryPodPort, exampleBuildOptions } from "../src/testing.js";

async function fixture(): Promise<Nanopublications> {
  const options = exampleBuildOptions();
  return buildNanopublications(
    {
      batch_id: "provenance-test",
      worker: { agent_id: "https://example.org/agents/client", agent_label: "Fictional reader" },
      sources: [
        {
          id: "codex",
          kind: "codex-thread",
          thread_id: "12345678-1234-4234-8234-123456789abc",
          title: "Fictional Codex conversation",
          model: "fictional-model",
          created: "2026-10-24T10:00:00Z",
        },
        {
          id: "claude",
          kind: "claude-session",
          thread_id: "23456789-1234-4234-8234-123456789abc",
          title: "Fictional Claude conversation",
        },
        {
          id: "document",
          kind: "document",
          url: "https://example.org/documents/one",
          title: "Fictional record",
          date: "2026-10-23",
        },
        { id: "email", kind: "email", url: "https://example.org/email/one" },
      ],
      claims: [
        {
          id: "one",
          assertion: createFactAssertion(options.owner, {
            template: "allergy",
            value: { id: "https://example.org/entities/allergy", name: "Fictional allergy" },
          }),
          epistemic: "SelfReportedExplicit",
          evidence: [
            {
              source: "codex",
              message_id: "first-message",
              timestamp: "2026-10-24T10:01:00Z",
              speaker: "me",
              quote: "Fictional quote.",
            },
            {
              source: "claude",
              message_id: "second-message",
              timestamp: "2026-10-24T10:02:00Z",
              speaker: "assistant",
            },
            { source: "document", locator: "page=2", quote: "Fictional document quote." },
            { source: "email" },
            { source: "codex" },
          ],
        },
        {
          id: "no-evidence",
          assertion: createFactAssertion(options.owner, {
            template: "email",
            value: "avery@example.org",
          }),
          epistemic: "Mentioned",
        },
      ],
    },
    options,
  );
}
function sources(value: Nanopublications) {
  return new NamedGraphDataset(
    df.namedNode(pkgId("batch", "provenance-test", "sources")),
    value.dataset,
    df,
  );
}
function np(value: Nanopublications) {
  const result = value.nanopubs.find((n) => n.identifier.endsWith("/one"));
  if (!result) throw new Error("Missing fixture");
  return result;
}
it("reads all source kinds and attaches message metadata to each evidence without mutations", async () => {
  const value = await parseNanopublications(await serializeNanopublications(await fixture()));
  const before = await serializeNanopublications(value);
  const provenance = readNanopubProvenance(value, np(value));
  expect(provenance).toMatchObject({
    agent: { iri: "https://example.org/agents/client", label: "Fictional reader" },
    batch: "provenance-test",
    generatedAt: "2026-10-25T12:00:00+00:00",
    attributedTo: [exampleBuildOptions().owner],
  });
  expect(provenance.sources.map((s) => s.kind).sort()).toEqual([
    "claude-session",
    "codex-thread",
    "document",
    "email",
  ]);
  expect(provenance.sources.find((s) => s.kind === "codex-thread")).toMatchObject({
    title: "Fictional Codex conversation",
    threadId: "12345678-1234-4234-8234-123456789abc",
    model: "fictional-model",
    created: "2026-10-24T10:00:00+00:00",
    url: undefined,
  });
  expect(provenance.sources.find((s) => s.kind === "document")).toMatchObject({
    iri: "https://example.org/documents/one",
    url: "https://example.org/documents/one",
    created: "2026-10-23",
  });
  expect(provenance.evidence.find((ev) => ev.quote === "Fictional quote.")).toMatchObject({
    timestamp: "2026-10-24T10:01:00+00:00",
    speaker: exampleBuildOptions().owner,
    quote: "Fictional quote.",
  });
  expect(provenance.evidence.find((ev) => ev.speaker === "assistant")?.speaker).toBe("assistant");
  expect(provenance.evidence.find((ev) => ev.locator === "page=2")).toMatchObject({
    locator: "page=2",
    quote: "Fictional document quote.",
    timestamp: undefined,
  });
  const empty = value.nanopubs.find((n) => n.identifier.endsWith("/no-evidence"));
  if (!empty) throw new Error("Missing fixture");
  expect(readNanopubProvenance(value, empty).sources).toEqual([]);
  expect(await serializeNanopublications(value)).toBe(before);
  provenance.attributedTo.push("https://example.org/other");
  expect(np(value).attributedTo).toHaveLength(1);
});
it("does not read other batch graphs or invent kinds for unknown records/providers", async () => {
  const value = await fixture();
  const graph = sources(value);
  const thread = "urn:uuid:12345678-1234-4234-8234-123456789abc";
  const source = new RdfNode(thread, graph);
  source.terms(`${NS.schema}provider`).clear();
  source.text(`${NS.schema}provider`, "Unknown provider");
  const document = new RdfNode("https://example.org/documents/one", graph);
  document.terms(`${NS.rdf}type`).clear();
  const result = readNanopubProvenance(value, np(value));
  expect(result.sources.find((s) => s.iri === thread)?.kind).toBeUndefined();
  expect(
    result.sources.find((s) => s.iri === "https://example.org/documents/one")?.kind,
  ).toBeUndefined();
  const empty = readNanopubProvenance(value, { ...np(value), batch: "unrelated" });
  expect(empty.agent.label).toBeUndefined();
  expect(empty.evidence.every((ev) => ev.timestamp === undefined && ev.speaker === undefined)).toBe(
    true,
  );
  expect(empty.sources.every((s) => s.kind === undefined && s.title === undefined)).toBe(true);
});
it.each([
  "duplicate",
  "wrong-datatype",
  "wrong-term",
] as const)("fails closed on %s provenance metadata without echoing contents", async (kind) => {
  const value = await fixture();
  const node = new RdfNode("https://example.org/documents/one", sources(value));
  if (kind !== "duplicate") node.terms(`${NS.schema}name`).clear();
  if (kind === "wrong-term") node.link(`${NS.schema}name`, "https://example.org/private-secret");
  else
    node.text(
      `${NS.schema}name`,
      "private-secret",
      kind === "wrong-datatype" ? `${NS.xsd}date` : undefined,
    );
  expect(() => readNanopubProvenance(value, np(value))).toThrow("Invalid provenance field");
});
it("exposes the store's supplied owner identity without I/O", () => {
  const options = exampleBuildOptions();
  const store = new NanopubStore(
    createMemoryPodPort({ root: "https://example.org/pod/", webId: options.owner }),
  );
  expect(store.ownerWebId).toBe(options.owner);
});
