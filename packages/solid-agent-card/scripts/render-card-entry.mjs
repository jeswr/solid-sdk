// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fromRdf, RECORD_MAPPINGS } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { readContainerMembers } from "@jeswr/ldp-container";
import { DatasetWrapper, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { describeAgent, verifyDescriptor } from "../src/index.ts";

const MAX_BYTES = 256 * 1024;
const MAX_BINDINGS = 100;

/** Bound reads and refuse redirects before consuming an untrusted container listing. */
function boundedFetch(fetch) {
  return async (url, init) => {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (response.redirected) throw new Error("Descriptor reads must not redirect.");
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Descriptor read exceeds byte limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/** Render from a trusted operator-selected descriptors/ URL. No pod or public writes. */
export async function renderCard(descriptor, containerUrl, fetch = globalThis.fetch) {
  const container = new URL(containerUrl);
  if (
    !["http:", "https:"].includes(container.protocol) ||
    !container.pathname.endsWith("/") ||
    container.search ||
    container.hash ||
    container.username ||
    container.password
  )
    throw new TypeError("Expected an http(s) descriptors/ container URL.");
  const read = boundedFetch(fetch);
  const members = await readContainerMembers(read, container.href, { scope: container.href });
  if (members === null) throw new Error("Descriptors container is missing.");
  const documents = members.filter((member) => !member.container);
  if (documents.length > MAX_BINDINGS) throw new Error("Too many binding descriptors.");
  const bindings = [];
  // Sort by code point so a server's listing order cannot change the generated card.
  for (const { url } of documents.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
    const response = await read(url, {
      headers: { accept: "text/turtle, application/ld+json;q=0.9" },
    });
    if (!response.ok) throw new Error("Could not read a binding descriptor.");
    const dataset = await parseRdf(await response.text(), response.headers.get("content-type"), {
      baseIRI: url,
    });
    const wrapped = new DatasetWrapper(dataset, DataFactory);
    const nodes = [
      ...wrapped.instancesOf(RECORD_MAPPINGS["channel-capability"].classIri, TermWrapper),
    ];
    if (nodes.length !== 1 || nodes[0].termType !== "NamedNode")
      throw new Error("Expected one capability per descriptor.");
    const capability = fromRdf(dataset, nodes[0].value);
    if (capability.type !== "channel-capability") throw new Error("Expected a channel capability.");
    bindings.push(capability);
  }
  const documentsOut = describeAgent({ ...descriptor, bindings });
  const turtle = await documentsOut.agentDescription.toTurtle();
  const verification = await verifyDescriptor(descriptor.id, {
    body: turtle,
    expectedId: descriptor.id,
  });
  if (!verification.valid) throw new Error("Generated description failed verification.");
  return documentsOut;
}

export async function main(args) {
  if (args.length !== 3)
    throw new Error(
      "Usage: render-card.mjs <descriptor.json> <descriptors-container-url> <output-directory>",
    );
  const [config, container, output] = args;
  const documents = await renderCard(JSON.parse(await readFile(config, "utf8")), container);
  const turtle = await documents.agentDescription.toTurtle();
  const jsonLd = await documents.agentDescription.toJsonLd();
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "agent-card.json"),
    `${JSON.stringify(documents.agentCard, null, 2)}\n`,
  );
  await writeFile(join(output, "agent-description.ttl"), turtle);
  await writeFile(join(output, "agent-description.jsonld"), `${JSON.stringify(jsonLd, null, 2)}\n`);
}
