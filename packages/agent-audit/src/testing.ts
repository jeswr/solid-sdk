// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuditFetch } from "./transport.js";
/** Anonymous in-memory Solid resource fixture, including conditional PUT semantics. */
export function createMemoryAuditPod() {
  const resources = new Map<string, { body: string; contentType: string; etag: string }>();
  const calls: { url: string; init: RequestInit }[] = [];
  let version = 0;
  const put = (url: string, body: string, contentType = "text/turtle") => {
    resources.set(url, { body, contentType, etag: `"${++version}"` });
  };
  const io: AuditFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const headers = new Headers(init.headers);
    if (headers.has("authorization") || headers.has("cookie"))
      throw new Error("Fixture requires zero credentials");
    const existing = resources.get(url);
    if (init.method === "PUT") {
      if (
        (headers.get("if-none-match") === "*" && existing) ||
        (headers.has("if-match") && headers.get("if-match") !== existing?.etag)
      )
        return new Response(null, { status: 412 });
      put(url, String(init.body), headers.get("content-type") as string);
      return new Response(null, {
        status: existing ? 204 : 201,
        headers: { ETag: (resources.get(url) as { etag: string }).etag },
      });
    }
    return existing
      ? new Response(existing.body, {
          headers: { "Content-Type": existing.contentType, ETag: existing.etag },
        })
      : new Response(null, { status: 404 });
  };
  return { fetch: io, resources, calls, put };
}
