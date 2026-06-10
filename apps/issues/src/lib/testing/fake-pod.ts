/**
 * A tiny stateful in-memory CSS for unit tests: GET/PUT/DELETE/HEAD with
 * synthesized container listings, ETags, and If-Match handling. Shared by the
 * repository and workspaces suites.
 */
export function fakePod(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const etags = new Map<string, number>();
  const bump = (url: string) => {
    etags.set(url, (etags.get(url) ?? 0) + 1);
    return `"${etags.get(url)}"`;
  };

  const containerListing = (container: string): string => {
    const members = [...store.keys()].filter(
      (k) => k.startsWith(container) && k !== container && !k.slice(container.length).includes("/"),
    );
    const triples = members.map((m) => `<${m}> a ldp:Resource.`).join("\n");
    return `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<${container}> a ldp:Container, ldp:BasicContainer.
${members.map((m) => `<${container}> ldp:contains <${m}>.`).join("\n")}
${triples}`;
  };

  const impl = async (url: string, init?: RequestInit) => {
    // Fragments never reach a real server — requests address documents.
    const u = String(url).split("#")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const ttl = { "content-type": "text/turtle", "wac-allow": 'user="read write append control"' };

    if (method === "PUT") {
      if (init?.headers) {
        const ifMatch = new Headers(init.headers).get("if-match");
        if (ifMatch && ifMatch !== `"${etags.get(u)}"`) return new Response(null, { status: 412 });
      }
      store.set(u, init?.body as string);
      return new Response(null, { status: 201, headers: { etag: bump(u) } });
    }
    if (method === "DELETE") {
      store.delete(u);
      return new Response(null, { status: 205 });
    }
    if (method === "HEAD") {
      return new Response(null, { status: store.has(u) ? 200 : 404, headers: ttl });
    }
    // GET
    if (u.endsWith("/")) {
      // a container (always "exists" once anything is under it, else 404)
      const hasMembers = [...store.keys()].some((k) => k.startsWith(u) && k !== u);
      if (!hasMembers) return new Response("Not found", { status: 404 });
      return new Response(containerListing(u), { status: 200, headers: { ...ttl, etag: bump(u) } });
    }
    if (!store.has(u)) return new Response("Not found", { status: 404 });
    return new Response(store.get(u)!, { status: 200, headers: { ...ttl, etag: `"${etags.get(u)}"` } });
  };
  return { impl: impl as unknown as typeof fetch, store };
}
