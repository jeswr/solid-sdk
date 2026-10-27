// AUTHORED-BY Codex GPT-6.1-Sol
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";

const ID = "google-drive";
/** RDF and malformed media types must go to the binary writer as opaque data. */
export function binaryType(contentType: string): string {
  const type = contentType.replace(/;.*$/s, "").trim().toLowerCase();
  const rdf = /^(text\/(turtle|n3)|application\/(ld\+json|n-triples|n-quads|trig|rdf\+xml))$/;
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) && !rdf.test(type)
    ? type
    : "application/octet-stream";
}

/** Accumulate at most cap bytes; cancel and abort at the first oversized chunk. */
async function readCapped(
  res: Response,
  cap: number,
  controller: AbortController,
): Promise<Uint8Array | undefined> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const cancel = async () => {
    try {
      await reader.cancel();
    } finally {
      controller.abort();
    }
  };
  try {
    const advertised = Number(res.headers.get("content-length"));
    if (advertised > cap) {
      await cancel();
      return undefined;
    }
    // One accumulator avoids retaining chunks plus a second concatenation buffer.
    const bytes = new Uint8Array(cap);
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return bytes.subarray(0, length);
      if (value.byteLength > cap - length) {
        await cancel();
        return undefined;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

export type Download = { body: Uint8Array } | { reason: string };
export async function download(
  api: typeof fetch,
  url: string,
  cap: number,
  exporting: boolean,
): Promise<Download> {
  const controller = new AbortController();
  const res = await api(url, { signal: controller.signal, redirect: "error" });
  if (res.status === 429) {
    await res.body?.cancel();
    const retry = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    throw new RateLimitedError(ID, url, retry || undefined);
  }
  if (!res.ok) {
    // Only this explicit Google export error is a metadata-only success.
    if (exporting && res.status === 403) {
      const bytes = await readCapped(res, 64 * 1024, controller);
      let error: { error?: { errors?: { reason?: string }[] } } | undefined;
      try {
        error = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        /* A malformed error is still a failed request. */
      }
      if (
        Array.isArray(error?.error?.errors) &&
        error.error.errors.some((item) => item?.reason === "exportSizeLimitExceeded")
      )
        return { reason: "exportSizeLimitExceeded" };
    } else await res.body?.cancel();
    throw new IntegrationSyncError(ID, `Drive answered ${res.status} while downloading content.`, {
      url,
      status: res.status,
    });
  }
  const body = await readCapped(res, cap, controller);
  return body === undefined ? { reason: "size-cap-exceeded" } : { body };
}
