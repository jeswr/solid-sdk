// AUTHORED-BY Codex GPT-6.1
import { DOCS_SLUG } from "@jeswr/solid-docs/layout";

/** Track only this import's create-only writes, never the original or shared setup. */
export function importTransaction(session: { storageUrl: string; fetch: typeof fetch }) {
  const root = new URL(DOCS_SLUG, session.storageUrl).href;
  const created = new Map<string, string | null>();
  const http: typeof fetch = async (input, init) => {
    const response = await session.fetch(input, init);
    const url = String(input);
    const headers = new Headers(init?.headers);
    const relative = url.slice(root.length);
    if (
      init?.method === "PUT" &&
      response.ok &&
      url.startsWith(root) &&
      (relative.includes("/") || relative.endsWith(".ttl")) &&
      (headers.get("if-none-match") === "*" || created.has(url))
    )
      created.set(url, response.headers.get("etag"));
    return response;
  };
  return {
    fetch: http,
    async rollback() {
      // Leaves before containers, and deepest containers first. A server refuses
      // nonempty containers, preserving anything another writer added meanwhile.
      const urls = [...created.keys()].sort(
        (a, b) =>
          Number(a.endsWith("/")) - Number(b.endsWith("/")) ||
          (a.endsWith("/") ? b.length - a.length : a.length - b.length),
      );
      for (const url of urls) {
        let etag = created.get(url);
        if (url.endsWith("/")) {
          // Membership changes the container validator as children are removed.
          const current = await session.fetch(url, { method: "HEAD", redirect: "error" });
          if (current.status === 404 || current.status === 410) continue;
          if (!current.ok) throw new Error("Couldn't inspect an incomplete import");
          etag = current.headers.get("etag");
        }
        // A changed snapshot/asset belongs to another writer. Never delete it.
        if (!etag || etag.startsWith("W/")) throw new Error("Missing import cleanup validator");
        const response = await session.fetch(url, {
          method: "DELETE",
          redirect: "error",
          headers: { "if-match": etag },
        });
        if (!response.ok && response.status !== 404 && response.status !== 410)
          throw new Error("Couldn't remove an incomplete import");
      }
    },
  };
}
