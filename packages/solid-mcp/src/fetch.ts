// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { requirePodScopedUrl, type SolidMcpConfig, scopedFetch } from "./auth.js";
import {
  assertLocalJsonLd,
  decodePrefix,
  limitedBody,
  MAX_CONTENT_BYTES,
  mediaType,
  resourceTitle,
} from "./content.js";
import { RDF_MEDIA_TYPES } from "./pod.js";

/** ChatGPT fetch result; binary bodies are omitted from text. */
export interface FetchResult {
  /** Canonical absolute resource URL, also used as the search id. */
  id: string;
  /** Decoded resource filename, falling back to the pod hostname. */
  title: string;
  /** Turtle or text content; empty for binaries and capped RDF. */
  text: string;
  /** Canonical absolute resource URL for citations. */
  url: string;
  /** Source media type, cap indicator, and optional resource version. */
  metadata: { contentType: string; truncated: boolean; etag?: string };
}

/** Fetch one absolute pod URL with a 1 MiB input and output cap. */
export async function fetchDocument(config: SolidMcpConfig, id: string): Promise<FetchResult> {
  // Unlike the lower-level pod helpers, tool ids must be absolute resource URLs.
  const target = requirePodScopedUrl(config, new URL(id).toString());
  const response = await scopedFetch(config)(target, {
    headers: { accept: "text/turtle, text/plain;q=0.9, */*;q=0.1" },
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`Failed to fetch pod resource: HTTP ${response.status}`);
  }
  const contentType = mediaType(response.headers.get("content-type"));
  const etag = response.headers.get("etag");
  const result: FetchResult = {
    id: target,
    title: resourceTitle(target),
    text: "",
    url: target,
    metadata: { contentType, truncated: false, ...(etag ? { etag } : {}) },
  };
  const rdf = RDF_MEDIA_TYPES.has(contentType);
  if (!rdf && !contentType.startsWith("text/")) {
    void response.body?.cancel().catch(() => {});
    return result;
  }
  const { bytes, truncated } = await limitedBody(response);
  result.metadata.truncated = truncated;
  if (rdf) {
    // A partial RDF input cannot safely be parsed; empty text is valid Turtle.
    if (truncated) return result;
    const source = decodePrefix(bytes, false);
    if (contentType === "application/ld+json") assertLocalJsonLd(source);
    const dataset = await parseRdf(
      source,
      contentType === "application/x-turtle" ? "text/turtle" : contentType,
      { baseIRI: target },
    );
    // Turtle represents a graph, not a dataset. Use the typed wrapper's graph
    // projection to render a union view without constructing RDF statements.
    const view = new Store();
    for (const graph of dataset.getGraphs(null, null, null)) {
      view.addQuads([...new NamedGraphDataset(graph, dataset, DataFactory)]);
    }
    result.text = await serialize(view.getQuads(null, null, null, null), {
      format: "text/turtle",
      emptyAsEmptyString: false,
    });
    // Serialization can expand relative IRIs. Never emit broken partial Turtle.
    if (Buffer.byteLength(result.text) > MAX_CONTENT_BYTES) {
      result.text = "";
      result.metadata.truncated = true;
    }
  } else {
    result.text = decodePrefix(bytes, truncated);
    // Invalid UTF-8 may expand to replacement characters during decoding.
    if (Buffer.byteLength(result.text) > MAX_CONTENT_BYTES) {
      result.text = decodePrefix(Buffer.from(result.text).subarray(0, MAX_CONTENT_BYTES), true);
      result.metadata.truncated = true;
    }
  }
  return result;
}
