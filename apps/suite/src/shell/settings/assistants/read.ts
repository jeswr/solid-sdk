// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, readBoundedText } from "@jeswr/guarded-fetch";
import type { AuditRead } from "@jeswr/mcp-connections";
import type { PodSession } from "@/lib/session/types";

/** Bound transport before materializing the text seam; never follow a pod redirect. */
export function auditRead(session: PodSession, signal: AbortSignal): AuditRead {
  return async (url) => {
    signal.throwIfAborted();
    const target = assertWithinPodScope(session.storageUrl, url);
    const response = await session.fetch(target, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { accept: "text/turtle, application/ld+json;q=0.9" },
    });
    if (
      signal.aborted ||
      !response.ok ||
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
        text: await readBoundedText(response, 256 * 1024, signal),
        contentType: response.headers.get("content-type") ?? "text/turtle",
      };
    } catch {
      signal.throwIfAborted();
      throw new Error("Personal data reads unavailable");
    }
  };
}
