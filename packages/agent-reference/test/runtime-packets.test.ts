// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import { canonicalNQuads } from "@jeswr/solid-vc";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { documentPacketSchema, traceFileSchema } from "../src/trace/schema.js";
import { readDocument } from "../src/wire/document.js";

it("records the exact signed document, context, same RDF dataset, and only attachment metadata", async () => {
  const root = new URL("../", import.meta.url).pathname;
  const input = loadCase(root, "mortgage-core");
  const trace = (await runScenario(input.profile, input.scenario))[0]!.trace!;
  expect(traceFileSchema.safeParse(trace).success).toBe(true);
  const packets = trace.events.flatMap((event) => (event.packet ? [event.packet] : []));
  expect(packets.length).toBeGreaterThan(0);
  for (const packet of packets) {
    expect(documentPacketSchema.safeParse(packet).success).toBe(true);
    const read = await readDocument(packet.jsonld!, "application/ld+json");
    if (!read.ok) throw new Error(read.detail);
    const rdf = await parseRdf(packet.rdf!, "application/trig");
    expect(await canonicalNQuads([...rdf])).toBe(await canonicalNQuads([...read.dataset]));
    expect(packet.context).toEqual(JSON.parse(packet.jsonld!)["@context"]);
    expect(packet.attachments?.every((item) => !Object.hasOwn(item, "bytes"))).toBe(true);
    const { rdf: omitted, ...partial } = packet;
    expect(documentPacketSchema.safeParse(partial).success).toBe(false);
  }
});

it.each([
  "salary-account-change",
  "mortgage-injected-fee",
])("keeps hostile and signature-stripped %s packets in document carriage", async (name) => {
  const input = loadCase(new URL("../", import.meta.url).pathname, name);
  const paths = await runScenario(input.profile, input.scenario);
  for (const path of paths) {
    expect(path.blocked).toBeUndefined();
    const packets = path.trace!.events.flatMap((event) => (event.packet ? [event.packet] : []));
    expect(packets.length).toBeGreaterThan(0);
    for (const packet of packets) {
      expect(documentPacketSchema.safeParse(packet).success).toBe(true);
      const read = await readDocument(packet.jsonld!, "application/ld+json");
      if (!read.ok) throw new Error(read.detail);
      const rdf = await parseRdf(packet.rdf!, "application/trig");
      expect(await canonicalNQuads([...rdf])).toBe(await canonicalNQuads([...read.dataset]));
    }
  }
});
