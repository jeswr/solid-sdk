// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { createHealthStore } from "../model";

/** A lost create response is recoverable only when the stored resource matches. */
async function createOrConfirm(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit | undefined,
  response: Response,
) {
  if (
    response.status !== 412 ||
    new Headers(init?.headers).get("if-none-match") !== "*" ||
    typeof init?.body !== "string" ||
    url.endsWith("/")
  )
    return response;
  const existing = await fetch(url, { redirect: "error" });
  if (!existing.ok) return response;
  const body = await existing.text();
  let matches = body === init.body;
  if (!matches && new Headers(init.headers).get("content-type") === "text/turtle") {
    // Health creates use deterministic named resources. Compare RDF rather than
    // prefix choices or statement order; a changed or extended graph conflicts.
    const intended = await parseRdf(init.body, "text/turtle", { baseIRI: url });
    const actual = await parseRdf(body, "text/turtle", { baseIRI: url });
    matches = intended.size === actual.size && [...intended].every((quad) => actual.has(quad));
  }
  return matches ? new Response(null, { status: 204, headers: existing.headers }) : response;
}

/**
 * The in-browser pod explicitly identifies its non-enforcing fixture transport.
 * It advertises `<resource>.acl` on existing HEADs, but omits Link on PUT/404.
 * Complete that fixture contract here. Never infer ACL URLs on real storage.
 */
export function healthTransport(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const received = await fetch(input, init);
    const response =
      method === "PUT" ? await createOrConfirm(fetch, url, init, received) : received;
    if (response.headers.get("x-solid-demo-access-control") !== "none") return response;
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
