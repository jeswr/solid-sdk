// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
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
    const reader = response.body?.getReader();
    const onAbort = () => {
      void reader?.cancel().catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 256 * 1024) throw new Error("Personal data reads unavailable");
          chunks.push(chunk.value);
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        contentType: response.headers.get("content-type") ?? "text/turtle",
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
      void reader?.cancel().catch(() => {});
    }
  };
}
