// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Small shared RDF I/O helpers for the pod layer: serialise a whole dataset to
 * Turtle via `n3.Writer` (never hand-built triples), and a conditional PUT
 * (`If-Match`) for read-modify-write of profile/index documents.
 */
import type { DatasetCore, Quad } from "@rdfjs/types";
import { Writer } from "n3";
import { PodWriteError } from "./pod-fs";

/** Serialise every quad in a dataset to a Turtle string (via `n3.Writer`). */
export function datasetToTurtle(dataset: DatasetCore): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const q of dataset as Iterable<Quad>) writer.addQuad(q);
  return new Promise((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

/**
 * Conditional PUT for read-modify-write. Sends `If-Match: <etag>` when an etag is
 * known (optimistic-concurrency); a `412` is surfaced so the caller can re-fetch
 * and re-apply (type-index skill). Throws {@link PodWriteError} on other non-2xx.
 */
export async function conditionalPut(
  authedFetch: typeof globalThis.fetch,
  url: string,
  body: string,
  etag: string | null,
  contentType = "text/turtle",
): Promise<void> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (etag) headers["if-match"] = etag;
  const res = await authedFetch(url, { method: "PUT", headers, body });
  if (!res.ok) throw new PodWriteError(url, res.status);
}
