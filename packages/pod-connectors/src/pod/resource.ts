// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { Writer } from "n3";
import type { MutationGuard } from "../core/types.js";

/** Base class so the UI can catch "anything from the data layer" if it wants. */
export class PodDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PodDataError";
  }
}

/** A conditional Pod PUT rejected by the server. */
export class ResourceWriteError extends PodDataError {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Could not save to your pod (${status}) at ${url}.`);
    this.name = "ResourceWriteError";
  }
}

/** Statuses that acknowledge a completed PUT. */
export function isCompletedPut(status: number): boolean {
  return status === 200 || status === 201 || status === 204;
}

/** Serialise RDF via N3 and PUT with explicit Turtle content type and preconditions. */
export async function writeResource(
  url: string,
  dataset: DatasetCore,
  opts: {
    etag?: string | null;
    createOnly?: boolean;
    fetchImpl?: typeof fetch;
    prefixes?: Record<string, string>;
    guard?: MutationGuard;
  } = {},
): Promise<{ etag: string | null; status: number }> {
  const body = await new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: "text/turtle", prefixes: opts.prefixes });
    for (const quad of dataset) writer.addQuad(quad);
    writer.end((error, turtle) => (error ? reject(error) : resolve(turtle)));
  });
  const headers = new Headers({ "content-type": "text/turtle" });
  if (opts.etag) headers.set("if-match", opts.etag);
  if (opts.createOnly) headers.set("if-none-match", "*");
  const refused = opts.guard?.();
  if (refused) return refused;
  const response = await (opts.fetchImpl ?? globalThis.fetch)(url, {
    method: "PUT",
    redirect: "error",
    headers,
    body,
  });
  if (!response.ok) throw new ResourceWriteError(url, response.status);
  return { etag: response.headers.get("etag"), status: response.status };
}
