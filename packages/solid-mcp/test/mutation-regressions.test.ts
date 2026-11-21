// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { LiteralFrom, RequiredAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { MAX_CONTENT_BYTES } from "../src/content.js";
import { fetchDocument } from "../src/fetch.js";
import { PodOutput } from "../src/output.js";
import { writeResource } from "../src/pod.js";
import { createFetchPodPort } from "../src/pod-port.js";

const ROOT = "https://pod.example/";
const ACP = "http://www.w3.org/ns/solid/acp#accessControl";

// Ported from the review's bypass.test.ts and ess.test.ts. Auxiliary identifiers
// have no Link header; ordinary CSS resources advertise both ACL and metadata.
function server(protocol: "css" | "ess" = "css") {
  const mutations: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = new Headers();
    if (protocol === "css" && !/\.(acl|meta|acr)$/i.test(url.pathname)) {
      headers.append("link", `<${url.href}.acl>; rel="acl"`);
      headers.append("link", `<${url.href}.meta>; rel="describedBy"`);
    } else if (protocol === "ess" && !url.search) {
      headers.set("link", `<${url.href}?ext=acr>; rel="${ACP}"`);
    }
    if (request.method === "HEAD")
      return new Response(null, {
        status: url.pathname.endsWith("/") || url.pathname.endsWith("existing") ? 200 : 404,
        headers,
      });
    if (["PUT", "DELETE"].includes(request.method)) {
      mutations.push(request);
      return new Response(null, { status: 201 });
    }
    return new Response("x", { headers: { "content-type": "text/plain" } });
  });
  return { mutations, fetch, pod: createFetchPodPort({ podRoot: ROOT, fetch, readOnly: false }) };
}

describe("mutation review regressions", () => {
  it.each(
    [
      "x.acl",
      "x.ac%6C",
      "x.ACL",
      "x.acl.",
      "x.acl%20",
      "x.ac\tl",
      "x.ac\nl",
      "x.acl\t",
      "existing.acl/",
      "x%2Eacl",
      "x.acl%2F",
      "x.acl//",
      "sub/.acl",
      ".meta",
      "x.acr",
      "x%C0%AEacl",
      "../data/x.acl",
      "notes;v2.acl",
      "leak;.acl",
      "x;y.meta",
      "note;v=2",
      "note%3Bv=2",
      "note?ext=acr",
      "note?",
      "note%3Fext=acr",
      "note#acl",
      "note#",
      "note%23acl",
      "note.",
      "note ",
      "note%20",
      "note./child",
      "note%20/child",
      "%6eote.txt",
      "note%2Etxt",
      "note%252Eacl",
      "note%2Fchild",
      "note%5Cchild",
    ].flatMap((path) => ["write", "delete"].map((kind) => ({ path, kind }))),
  )("refuses $kind of ambiguous CSS target $path before mutation", async ({ path, kind }) => {
    const f = server();
    const target = `${ROOT}data/${path}`;
    await expect(
      kind === "write"
        ? writeResource(f.pod, target, "x", "text/plain")
        : new PodOutput(f.pod).delete(target),
    ).rejects.toThrow(/access-control|description|pod-scope|purpose-limited/);
    expect(f.mutations).toEqual([]);
  });

  it("permits a CSS data write with separate ACL and mixed-case describedBy Link fields", async () => {
    const f = server();
    await writeResource(f.pod, `${ROOT}data/memo.txt`, "x", "text/plain");
    expect(f.mutations).toHaveLength(1);
  });

  it.each([undefined, '"e"'])("permits ESS data writes with condition %s", async (etag) => {
    const f = server("ess");
    await writeResource(
      f.pod,
      `${ROOT}data/${etag ? "existing" : "new.txt"}`,
      "x",
      "text/plain",
      etag,
    );
    expect(f.mutations).toHaveLength(1);
  });

  it("refuses the ESS query ACR itself", async () => {
    const f = server("ess");
    await expect(
      writeResource(f.pod, `${ROOT}data/existing?ext=acr`, "x", "text/plain", '"e"'),
    ).rejects.toThrow(/access-control|description/);
    expect(f.mutations).toEqual([]);
  });

  it("protects LWS linksets advertised by the parent", async () => {
    const f = server();
    f.pod.head = async () => ({ auxiliaryResources: [`${ROOT}data/links`] });
    // Exercise wire parsing too, independently of the portable metadata contract.
    const fetch: typeof globalThis.fetch = async () =>
      new Response(null, {
        headers: { link: '<links>; rel="linkset"' },
      });
    const pod = createFetchPodPort({ podRoot: ROOT, fetch, readOnly: false });
    await expect(writeResource(pod, `${ROOT}data/links`, "x", "text/plain")).rejects.toThrow(
      /access-control|description/,
    );
  });

  it("refuses arbitrary container description RDF through the fetch output", async () => {
    class Description extends TermWrapper {
      set title(value: string) {
        RequiredAs.object(this, "http://purl.org/dc/terms/title", value, LiteralFrom.string);
      }
    }
    const f = server();
    f.pod.head = async () => ({ auxiliaryResources: [], exists: false });
    const target = `${ROOT}data/new/`;
    const store = new Store();
    new Description(target, store, DataFactory).title = "agent-controlled description";
    await expect(
      new PodOutput(f.pod).write(
        target,
        new TextEncoder().encode(await serialize([...store], { format: "text/turtle" })),
        "text/turtle",
        { ifNoneMatch: "*" },
      ),
    ).rejects.toThrow(/Container creation/);
    expect(f.mutations).toEqual([]);
  });

  it.each(["text/plain", "text/turtle"])("omits the ETag for truncated %s", async (contentType) => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(" ".repeat(MAX_CONTENT_BYTES + 1), {
        headers: { "content-type": contentType, etag: '"complete"' },
      });
    const result = await fetchDocument({ podRoot: ROOT, fetch }, `${ROOT}data/large`);
    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.etag).toBeUndefined();
  });
});
