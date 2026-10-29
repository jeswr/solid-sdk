// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { requirePodScopedUrl } from "./auth.js";
import { parseBoundedRdf, RdfLimitError, serializeBoundedTurtle } from "./bounded-rdf.js";
import {
  decodePrefix,
  limitedBody,
  MAX_CONTENT_BYTES,
  mediaType,
  RDF_MEDIA_TYPES,
  resourceTitle,
} from "./content.js";
import { PodOutput } from "./output.js";
import { withPodFetchLimits } from "./pod-operation.js";
import { asPodPort, isFetchPodRead, type PodSource } from "./pod-port.js";

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
  // Unlike the lower-level pod helpers, tool ids must be absolute resource URLs.
  const target = requirePodScopedUrl({ podRoot: pod.root }, new URL(id).toString());
  const accept = "text/turtle, text/plain;q=0.9, */*;q=0.1";
  const readMethod = pod.read;
  const output = new PodOutput(pod);
  const read = await withPodFetchLimits(
    (fetcher) => boundFetchBody(fetcher, isFetchPodRead(readMethod)),
    () => output.read(target, { accept }),
  );
  const finalUrl = requirePodScopedUrl({ podRoot: pod.root }, read.url ?? target);
  const response = new Response(
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
    return output.value(result, target);
  }
  const { bytes, truncated } = await limitedBody(response);
  result.metadata.truncated = truncated;
  if (rdf) {
    // A partial RDF input cannot safely be parsed; empty text is valid Turtle.
    if (truncated) return output.value(result, target);
    const decoded = decodePrefix(bytes, false);
    try {
      const dataset = await parseBoundedRdf(decoded, contentType, response.url || target);
      const filtered = await output.rdf(target, read, dataset);
      result.text = serializeBoundedTurtle(filtered);
      if (filtered !== dataset) delete result.metadata.etag;
    } catch (error) {
      if (!(error instanceof RdfLimitError)) throw error;
      result.metadata.truncated = true;
    }
  } else {
    result.text = await output.text(decodePrefix(bytes, truncated), target);
    // Invalid UTF-8 may expand to replacement characters during decoding.
    if (Buffer.byteLength(result.text) > MAX_CONTENT_BYTES) {
      result.text = decodePrefix(Buffer.from(result.text).subarray(0, MAX_CONTENT_BYTES), true);
      result.metadata.truncated = true;
    }
  }
  // RDF was projected as terms before Writer serialization, never edit its text.
  result.title = await output.text(result.title, target);
  result.metadata = await output.value(result.metadata, target);
  return result;
}

/** Bound the adapter's download without bypassing any injected read decorator. */
function boundFetchBody(fetcher: typeof fetch, nativeRead: boolean): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    // Redirects and errors belong to the adapter's scope/status checks.
    if (!response.ok) return response;
    const contentType = mediaType(response.headers.get("content-type"));
    let body: Uint8Array | null = null;
    if (!nativeRead || RDF_MEDIA_TYPES.has(contentType) || contentType.startsWith("text/")) {
      // One overflow byte carries truncation across the raw-byte PodPort seam.
      const limited = await limitedBody(response, undefined, nativeRead);
      // A decorator may authorize only after examining the entire body. Never
      // let truncation hide a denial, or omit binary bytes from such a check.
      if (limited.truncated && !nativeRead) {
        throw new Error("Resource exceeds the bounded read limit.");
      }
      body = limited.bytes;
    } else {
      void response.body?.cancel().catch(() => {});
    }
    const bounded = new Response(
      response.body === null || body === null ? null : new Uint8Array(body),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
    Object.defineProperty(bounded, "url", { value: response.url });
    return bounded;
  };
}
