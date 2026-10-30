// AUTHORED-BY Codex
import { DataFactory, Store } from "n3";
import { parentOf } from "../src/apps/drive/lib/client/client";
import { turtle, WacFields } from "./drive-wac-pod";

/** Protocol transport with ACP discovery or a 403 ACL, without demo capabilities. */
export function nonWacPod(model: "ACP" | "unreadable ACL", root: string, source: string) {
  const resources = new Map<string, string>([[source, "Private data"]]);
  for (let folder = parentOf(source); folder; folder = parentOf(folder)) resources.set(folder, "");
  const calls: { url: string; method: string; headers: Headers }[] = [];
  const revisions = new Map<string, number>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const conditions = new Headers(init?.headers);
    calls.push({ url, method, headers: conditions });
    const etag = revisions.has(url) ? `"revision-${revisions.get(url)}"` : '"original"';
    const headers = new Headers({
      link:
        model === "ACP"
          ? `<${url}.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"`
          : `<${url}.acl>; rel="acl"`,
      etag,
      "content-type": "text/turtle",
    });
    if (model === "ACP") headers.set("ACP-Allow", 'user="read write"');
    if (url.endsWith(".acl")) return new Response(null, { status: 403 });
    if (url.endsWith(".acr")) {
      const data = new Store();
      new WacFields(url, data, DataFactory)
        .iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
        .add("http://www.w3.org/ns/solid/acp#AccessControlResource");
      return new Response(await turtle(data), { headers });
    }
    if (!url.startsWith(root) || !resources.has(url))
      return new Response(null, { status: 404, headers });
    if (conditions.has("if-match") && conditions.get("if-match") !== etag)
      return new Response(null, { status: 412 });
    if (method === "DELETE") {
      if (!conditions.has("if-match")) return new Response(null, { status: 428 });
      if ([...resources.keys()].some((member) => member !== url && parentOf(member) === url))
        return new Response(null, { status: 409 });
      resources.delete(url);
      const parent = parentOf(url);
      if (parent) revisions.set(parent, (revisions.get(parent) ?? 0) + 1);
      return new Response(null, {
        status: 204,
        headers: {
          "x-solid-drive-parent-validators": JSON.stringify(
            parent ? { [parent]: `"revision-${revisions.get(parent)}"` } : {},
          ),
        },
      });
    }
    const data = new Store();
    if (url.endsWith("/"))
      for (const member of resources.keys())
        if (parentOf(member) === url)
          new WacFields(url, data, DataFactory)
            .iris("http://www.w3.org/ns/ldp#contains")
            .add(member);
    return new Response(
      method === "HEAD" ? null : url.endsWith("/") ? await turtle(data) : resources.get(url),
      {
        headers,
      },
    );
  };
  return { fetch, calls, has: (url: string) => resources.has(url) };
}
