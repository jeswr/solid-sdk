// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
export const BASE = "https://pod.example/storage/health/";
export const OWNER = "https://pod.example/profile#me";
export interface Resource {
  body: string;
  etag: string;
  type: string;
  container?: boolean;
}
export function podFixture() {
  const resources = new Map<string, Resource>();
  const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
  const faults = new Map<string, () => Response>();
  let revision = 0;
  const put = (path: string, body: string, type = "text/turtle") =>
    resources.set(new URL(path, BASE).href, { body, etag: `"${++revision}"`, type });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? "");
    calls.push({ url, method, headers, body });
    const fault = faults.get(`${method} ${url}`);
    if (fault) return fault();
    const resource = resources.get(url);
    const responseHeaders: Record<string, string> = {
      "content-type": resource?.type ?? "text/turtle",
    };
    if (resource) responseHeaders.etag = resource.etag;
    if (!url.endsWith(".acl")) responseHeaders.link = `<${url}.acl>; rel="acl"`;
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && resource)
        return new Response(null, { status: 412 });
      if (headers.has("if-match") && headers.get("if-match") !== resource?.etag)
        return new Response(null, { status: 412 });
      const etag = `"${++revision}"`;
      resources.set(url, {
        body,
        etag,
        type: headers.get("content-type") ?? "text/turtle",
        ...(url.endsWith("/") ? { container: true } : {}),
      });
      return new Response(null, { status: 201, headers: { ...responseHeaders, etag } });
    }
    if (!resource) return new Response(null, { status: 404 });
    if (method === "HEAD") return new Response(null, { status: 200, headers: responseHeaders });
    if (resource.container) {
      const children = [...resources.keys()].filter((entry) => {
        if (!entry.startsWith(url) || entry === url || entry.endsWith(".acl")) return false;
        const tail = entry.slice(url.length).replace(/\/$/, "");
        return !tail.includes("/");
      });
      const listing = children
        .map((entry) => `<${url}> <${NS.LDP}contains> <${entry}>.`)
        .join("\n");
      return new Response(listing, { headers: responseHeaders });
    }
    return new Response(resource.body, { headers: responseHeaders });
  };
  return { fetch, resources, calls, faults, put };
}
