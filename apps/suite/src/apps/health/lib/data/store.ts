// AUTHORED-BY Codex GPT-6
import { createHealthStore } from "../model";

/**
 * The in-browser pod explicitly identifies its non-enforcing fixture transport.
 * It advertises `<resource>.acl` on existing HEADs, but omits Link on PUT/404.
 * Complete that fixture contract here. Never infer ACL URLs on real storage.
 */
export function healthTransport(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.headers.get("x-solid-demo-access-control") !== "none") return response;
    const request = input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (method === "HEAD" && response.status === 404) {
      const headers = new Headers(response.headers);
      headers.set("link", `<${url}.acl>; rel="acl"`);
      return new Response(null, { status: response.status, headers });
    }
    if (method === "PUT" && response.ok && url.endsWith("/")) {
      const metadata = await fetch(url, { method: "HEAD", redirect: "error" });
      const link = metadata.headers.get("link");
      if (!metadata.ok || !link) throw new Error("Couldn't inspect private demo storage");
      const headers = new Headers(response.headers);
      headers.set("link", link);
      return new Response(null, { status: response.status, headers });
    }
    return response;
  };
}
export function createHealthDataStore(
  fetch: typeof globalThis.fetch,
  storageRoot: string,
  owner: string,
) {
  return createHealthStore(healthTransport(fetch), storageRoot, owner);
}
