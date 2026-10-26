// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { requirePodScopedUrl, scopedFetch } from "./auth.js";
import { parseBoundedRdf, RdfLimitError, serializeBoundedTurtle } from "./bounded-rdf.js";
import {
  decodePrefix,
  limitedBody,
  MAX_CONTENT_BYTES,
  mediaType,
  resourceTitle,
} from "./content.js";
import { RDF_MEDIA_TYPES } from "./pod.js";
import { asPodPort, fetchConfig, type PodSource } from "./pod-port.js";

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
export async function fetchDocument(source: PodSource, id: string): Promise<FetchResult> {
  const pod = asPodPort(source);
  const config = fetchConfig(source);
  // Unlike the lower-level pod helpers, tool ids must be absolute resource URLs.
  const target = requirePodScopedUrl({ podRoot: pod.root }, new URL(id).toString());
  const accept = "text/turtle, text/plain;q=0.9, */*;q=0.1";
  let response: Response;
  if (config) {
    response = await scopedFetch(config)(target, { headers: { accept } });
  } else {
    const read = await pod.read(target, { accept });
    const finalUrl = requirePodScopedUrl({ podRoot: pod.root }, read.url ?? target);
    response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(read.body);
          controller.close();
        },
      }),
      {
        headers: { "content-type": read.contentType, ...(read.etag ? { etag: read.etag } : {}) },
      },
    );
    Object.defineProperty(response, "url", { value: finalUrl });
  }
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
    const decoded = decodePrefix(bytes, false);
    try {
      const dataset = await parseBoundedRdf(decoded, contentType, response.url || target);
      result.text = serializeBoundedTurtle(dataset);
    } catch (error) {
      if (!(error instanceof RdfLimitError)) throw error;
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
