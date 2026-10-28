// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { containerData } from "../src/apps/drive/lib/client/rdf";
import { turtle, wacPod } from "./drive-wac-pod";

/** Persist application container RDF and bind its edits to the response validator. */
export async function rdfPod() {
  const f = await wacPod();
  const raw = f.pod.fetch;
  const graphs = new Map<string, Store>();
  const revisions = new Map<string, number>();
  const folderFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.endsWith("/")) return raw(input, init);
    const method = init?.method ?? "GET";
    const prior = await raw(url, { method: "HEAD" });
    const tag = (etag: string | null) => `"${etag?.slice(1, -1)}-rdf-${revisions.get(url) ?? 0}"`;
    const headers = new Headers(init?.headers);
    if (headers.has("if-match") && headers.get("if-match") !== tag(prior.headers.get("etag")))
      return new Response(null, { status: 412 });
    headers.delete("if-match");
    const response = await raw(input, { ...init, headers });
    if (!response.ok) return response;
    if (method === "PUT") {
      const body = init?.body instanceof Blob ? await init.body.text() : String(init?.body ?? "");
      graphs.set(url, containerData(await parseRdf(body, "text/turtle"), url));
      revisions.set(url, (revisions.get(url) ?? 0) + 1);
    }
    if (method === "DELETE") {
      graphs.delete(url);
      return response;
    }
    const out = new Headers(response.headers);
    out.set("etag", tag(response.headers.get("etag")));
    if (method !== "GET")
      return new Response(response.body, { status: response.status, headers: out });
    const dataset = new Store([
      ...(await parseRdf(await response.text(), "text/turtle")),
      ...(graphs.get(url) ?? []),
    ]);
    return new Response(await turtle(dataset), { status: response.status, headers: out });
  };
  Object.defineProperty(f.pod, "fetch", { value: folderFetch });
  return f;
}
