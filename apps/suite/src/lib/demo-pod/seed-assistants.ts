// AUTHORED-BY Codex GPT-6.1-Sol
import { auditContainer } from "@jeswr/mcp-connections";
import { LiteralFrom, NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { DEMO_ROOT } from "./constants";
import type { DemoSeedFile } from "./pod";

const PROV = "http://www.w3.org/ns/prov#";
const DPV = "https://w3id.org/dpv#";
class SeedRead extends TermWrapper {
  iri(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  time(value: Date) {
    OptionalAs.object(this, `${PROV}startedAtTime`, value, LiteralFrom.dateTime);
  }
}

/** Metadata only, matching the monthly MCP writer; no connection records are seeded in S1. */
export async function seedAssistants(now: number): Promise<DemoSeedFile[]> {
  const month = new Date(now).toISOString().slice(0, 7);
  const url = new URL(`${month}.ttl`, auditContainer(DEMO_ROOT)).href;
  const dataset = new Store();
  for (const [index, client] of [
    "https://mcp.example/clients/demo",
    "https://assistant.example/app",
  ].entries()) {
    const activity = new SeedRead(`${url}#read-${index}`, dataset, DataFactory);
    activity.iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${PROV}Activity`);
    activity.iri(`${PROV}wasAssociatedWith`, client);
    activity.time(new Date(now - (index + 1) * 3600000));
    activity.iri(`${DPV}hasPurpose`, `${DPV}ServiceProvision`);
    activity.iri(`${DPV}hasPersonalData`, "https://w3id.org/dpv/pd#Health");
  }
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  return [{ path: url.slice(DEMO_ROOT.length), body, contentType: "text/turtle", modified: now }];
}
