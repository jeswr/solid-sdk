// AUTHORED-BY Claude Sonnet 5.5

import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";

export const ROOT = "https://host.example/";
export const OWNER = `${ROOT}profile/card#me`;
export const session = (fetch: typeof globalThis.fetch) => ({
  fetch,
  storageUrl: ROOT,
  webId: OWNER,
  mode: "solid",
});

/** A WAC-advertising memory pod plus the transport a pod-scoped client would use. Access
 * documents are plain resources, so the real pod-access code runs end to end. */
export function pod(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root: ROOT, protocol });
  storage.features.accessControl = {
    state: "available",
    detail: { model: "wac" },
    evidence: "fixture",
  };
  const head = storage.head.bind(storage);
  storage.head = async (...args) => ({
    ...(await head(...args)),
    links: new Map([["acl", [{ target: `${args[0]}.acl`, params: {} }]]]),
  });
  const writes: { method: string; url: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") writes.push({ method, url });
    try {
      if (method === "POST") {
        const name = new Headers(init?.headers).get("slug") ?? "assigned.ttl";
        const created = await storage.create(url, String(init?.body ?? ""), {
          name,
          contentType: "text/turtle",
        });
        return new Response(null, { status: 201, headers: { location: created.url } });
      }
      if (method === "PUT") {
        const headers = new Headers(init?.headers);
        if (headers.get("if-none-match") === "*") {
          await storage.create(new URL(".", url).href, String(init?.body ?? ""), {
            name: url.split("/").at(-1),
            contentType: headers.get("content-type") ?? "text/turtle",
          });
        } else
          await storage.write(url, String(init?.body ?? ""), {
            contentType: "text/turtle",
            ifMatch: headers.get("if-match") ?? "missing",
          });
        return new Response(null, { status: 201 });
      }
      if (method === "DELETE") {
        await storage.delete(url);
        return new Response(null, { status: 204 });
      }
      const result = await storage.read(url);
      return new Response(method === "HEAD" ? null : await result.text(), {
        headers: {
          "content-type": "text/turtle",
          etag: result.etag ?? "",
          link: `<${url}.acl>; rel="acl"`,
          "wac-allow": `user="read write control",public=""`,
        },
      });
    } catch (error) {
      if (error instanceof StorageError) return new Response(null, { status: error.status ?? 500 });
      throw error;
    }
  };
  return { storage, fetch, writes };
}
