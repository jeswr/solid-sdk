// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, readBoundedText } from "@jeswr/guarded-fetch";
import type { AuditRead } from "@jeswr/mcp-connections";
import type { PodSession } from "@/lib/session/types";

/** Bound transport before materializing the text seam; never follow a pod redirect. */
export function auditRead(session: PodSession, signal: AbortSignal): AuditRead {
  return async (url) => {
    const { text, contentType } = await readDocument(session, url, signal);
    return { text, contentType };
  };
}

/** One bounded owner-session read, including the validator of those exact bytes. */
export async function readDocument(
  session: PodSession,
  url: string,
  signal: AbortSignal,
  maxBytes = 256 * 1024,
) {
  signal.throwIfAborted();
  const target = assertWithinPodScope(session.storageUrl, url);
  const response = await session.fetch(target, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  if (
    signal.aborted ||
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== target)
  ) {
    void response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    throw Object.assign(new Error("Personal data reads unavailable"), {
      status: response.status,
    });
  }
  try {
    return {
      text: await readBoundedText(response, maxBytes, signal),
      contentType: response.headers.get("content-type") ?? "text/turtle",
      etag: response.headers.get("etag"),
    };
  } catch {
    signal.throwIfAborted();
    throw new Error("Personal data reads unavailable");
  }
}
