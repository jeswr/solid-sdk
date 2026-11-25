// AUTHORED-BY Codex GPT-6.1-Sol
import { ResponseTooLargeError, readBytes, readJson } from "../core/budget.js";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { SourceTimeoutError } from "../core/source-timeout.js";

const ID = "google-drive";
/** RDF and malformed media types must go to the binary writer as opaque data. */
export function binaryType(contentType: string): string {
  const type = contentType.replace(/;.*$/s, "").trim().toLowerCase();
  const rdf = /^(text\/(turtle|n3)|application\/(ld\+json|n-triples|n-quads|trig|rdf\+xml))$/;
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) && !rdf.test(type)
    ? type
    : "application/octet-stream";
}

export type Download = { body: Uint8Array } | { reason: string };
export async function download(
  api: typeof fetch,
  url: string,
  cap: number,
  exporting: boolean,
): Promise<Download> {
  const controller = new AbortController();
  try {
    const res = await api(url, { signal: controller.signal, redirect: "error" });
    if (res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      const retry = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      throw new RateLimitedError(ID, url, retry || undefined);
    }
    if (!res.ok) {
      // Only this explicit Google export error is a metadata-only success.
      if (exporting && res.status === 403) {
        let error: { error?: { errors?: { reason?: string }[] } } | undefined;
        try {
          error = (await readJson(res, ID, url, 64 * 1024)) as typeof error;
        } catch (cause) {
          if (
            !(cause instanceof ResponseTooLargeError) &&
            !(cause instanceof IntegrationSyncError && cause.cause instanceof SyntaxError)
          )
            throw cause;
          /* A malformed error is still a failed request. */
        }
        if (
          Array.isArray(error?.error?.errors) &&
          error.error.errors.some((item) => item?.reason === "exportSizeLimitExceeded")
        )
          return { reason: "exportSizeLimitExceeded" };
      } else await res.body?.cancel().catch(() => undefined);
      throw new IntegrationSyncError(
        ID,
        `Drive answered ${res.status} while downloading content.`,
        {
          url,
          status: res.status,
        },
      );
    }
    try {
      return { body: await readBytes(res, ID, url, cap) };
    } catch (error) {
      controller.abort();
      if (error instanceof ResponseTooLargeError) return { reason: "size-cap-exceeded" };
      throw error;
    }
  } catch (error) {
    if (error instanceof SourceTimeoutError) return { reason: "timeout" };
    throw error;
  }
}
