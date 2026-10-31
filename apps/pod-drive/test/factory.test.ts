// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createDriveStore } from "../src/drive.js";

// Exercise real factory discovery separately from legacy HTTP-contract fixtures.
vi.unmock("@jeswr/storage-client");

describe.each(["solid", "lws"] as const)("real PodClient discovery for %s", (protocol) => {
  it("uses the authenticated transport for discovery and app data", async () => {
    const root = `https://${protocol}.pod-drive-factory.example/`;
    const description = `${root}.well-known/storage`;
    const file = `${root}note.ttl`;
    const requests: { method: string; url: string; accept: string | null }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url, accept: new Headers(init?.headers).get("accept") });
      if (method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: { allow: "GET, HEAD, PUT, POST, DELETE" },
        });
      if (url === description) {
        const body =
          protocol === "solid"
            ? `<${root}> a <http://www.w3.org/ns/pim/space#Storage>.`
            : JSON.stringify({
                "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
                id: description,
                type: "Storage",
                service: [{ type: "StorageRoot", serviceEndpoint: root }],
              });
        return new Response(body, {
          headers: { "content-type": protocol === "solid" ? "text/turtle" : "application/lws+cid" },
        });
      }
      const links =
        protocol === "solid"
          ? `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <http://www.w3.org/ns/pim/space#Storage>; rel="type"`
          : `<${description}>; rel="https://www.w3.org/ns/lws#storage", <${root}>; rel="up"`;
      if (method === "HEAD")
        return new Response(null, { headers: { link: links, etag: '"root"' } });
      if (url === file)
        return new Response(
          '<#it> a <https://vocab.jeswr.org/pod-docs#Document>; <http://purl.org/dc/terms/title> "A note".',
          { headers: { "content-type": "text/turtle", link: links, etag: '"file"' } },
        );
      if (url === root)
        return new Response(
          protocol === "solid"
            ? `<${root}> a <http://www.w3.org/ns/ldp#Container>; <http://www.w3.org/ns/ldp#contains> <${file}>.`
            : JSON.stringify({
                type: "Container",
                items: [{ id: file, type: "DataResource", format: "text/turtle" }],
              }),
          {
            headers: {
              "content-type": protocol === "solid" ? "text/turtle" : "application/lws+json",
              link: links,
              etag: '"root"',
            },
          },
        );
      throw new Error("Unexpected SDK request");
    });
    const entries = (await createDriveStore({ root, fetch }).list()).container.entries;
    expect(entries.map((entry) => entry.name)).toEqual(["note.ttl"]);
    expect(requests.some((request) => request.url === description)).toBe(true);
    expect(
      requests.find((request) => request.method === "GET" && request.url === root)?.accept,
    ).toContain(protocol === "solid" ? "text/turtle" : "application/lws+json");
  });
});
