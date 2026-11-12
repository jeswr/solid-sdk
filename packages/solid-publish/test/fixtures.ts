// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import type { PageData, SiteData } from "../src/index.js";
export const root = "https://pod.example/";
export const owner = `${root}profile/card#me`;
export const at = new Date("2026-11-10T12:00:00Z");
export const siteData: SiteData = {
  name: "Field notes",
  description: "Notes & discoveries",
  author: "Robin Fiction",
  theme: "paper",
  inLanguage: "en-GB",
  created: at,
  modified: at,
};
export const pageData: PageData = {
  title: "A good beginning",
  slug: "a-good-beginning",
  body: "## Welcome\n\n**Hello**, world.",
  summary: "A little introduction.",
  kind: "post",
  status: "draft",
  position: 0,
  modified: at,
};
/** Actual storage-client ETags and RDF; only the access-document HEAD seam is synthetic. */
export async function podFixture() {
  const backing = createMemoryStorage({ root, protocol: "solid" });
  await backing.create(root, null, { name: "profile", kind: "container" });
  await backing.create(
    `${root}profile/`,
    `@prefix pim: <http://www.w3.org/ns/pim/space#>. <${owner}> pim:storage <${root}>.`,
    { name: "card", contentType: "text/turtle" },
  );
  await backing.create(
    root,
    `@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#owner> a acl:Authorization; acl:agent <${owner}>; acl:accessTo <${root}>; acl:default <${root}>; acl:mode acl:Read, acl:Write, acl:Control.`,
    { name: ".acl", contentType: "text/turtle" },
  );
  const calls: { url: string; method: string; body: unknown }[] = [];
  let intercept: ((url: string, init: RequestInit) => Response | undefined) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    const overridden = intercept?.(url, init);
    if (overridden) return overridden;
    try {
      const headers = new Headers(init.headers);
      if (method === "PUT") {
        const existing = await backing.head(url).catch((error: unknown) => {
          if (error instanceof StorageError && error.code === "not-found") return null;
          throw error;
        });
        if (existing) {
          if (headers.get("if-match") !== existing.etag) return new Response(null, { status: 412 });
          await backing.write(url, String(init.body), {
            ifMatch: existing.etag as string,
            contentType: headers.get("content-type") ?? "text/turtle",
          });
        } else {
          if (headers.get("if-none-match") !== "*") return new Response(null, { status: 412 });
          const parent = new URL(url.endsWith("/") ? "../" : "./", url).href;
          await backing.create(parent, String(init.body), {
            name: url.slice(parent.length).replace(/\/$/, ""),
            kind: url.endsWith("/") ? "container" : "resource",
            contentType: headers.get("content-type") ?? "text/turtle",
          });
        }
        return new Response(null, { status: 204 });
      }
      const result = method === "HEAD" ? await backing.head(url) : await backing.read(url);
      const responseHeaders = new Headers({
        "content-type": result.contentType ?? "text/turtle",
        etag: result.etag as string,
        "wac-allow": 'user="read write append control",public=""',
      });
      if (!url.endsWith(".acl"))
        responseHeaders.set(
          "link",
          `<${url}.acl>; rel="acl"${url === root ? ', <http://www.w3.org/ns/pim/space#Storage>; rel="type"' : ""}`,
        );
      if (url === root) responseHeaders.set("updates-via", "wss://pod.example/");
      return new Response(method === "HEAD" ? null : await result.text(), {
        headers: responseHeaders,
      });
    } catch (error) {
      if (error instanceof StorageError) return new Response(null, { status: error.status ?? 500 });
      throw error;
    }
  };
  const backend = createSolidBackend({ fetch, root });
  const storage = {
    ...backing,
    head: backend.head,
    read: backend.read,
    readRdf: backend.readRdf,
    features: {
      ...backing.features,
      accessControl: {
        state: "available" as const,
        evidence: "fixture",
        detail: { model: "wac" as const },
      },
    },
  };
  return {
    storage,
    fetch,
    calls,
    intercept(fn: typeof intercept) {
      intercept = fn;
    },
    wrap(overrides: Partial<StorageClient>): StorageClient {
      return { ...storage, ...overrides };
    },
  };
}
