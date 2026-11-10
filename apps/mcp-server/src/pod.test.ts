// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { withCssCompatibility } from "./pod.js";

it("recovers CSS binary write validators only after byte-exact authenticated readback", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(
      new Response("bytes", {
        headers: { "content-type": "application/octet-stream", etag: '"strong"' },
      }),
    );
  const response = await withCssCompatibility(fetcher)("https://pod.example/private/lock", {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "if-none-match": "*" },
    body: "bytes",
  });
  expect(response.headers.get("etag")).toBe('"strong"');
  const written = fetcher.mock.calls[0]?.[0];
  if (!(written instanceof Request)) throw new Error("Expected snapshot request");
  expect(written.headers.get("if-none-match")).toBe("*");
  expect(fetcher.mock.calls[1]).toEqual([
    "https://pod.example/private/lock",
    { method: "GET", redirect: "manual" },
  ]);
});
it.each([
  { body: "changed", contentType: "application/octet-stream", etag: '"strong"', status: 200 },
  { body: "bytes", contentType: "application/octet-stream", etag: 'W/"weak"', status: 200 },
  { body: "bytes", contentType: "text/turtle", etag: '"strong"', status: 200 },
  { body: "bytes", contentType: "application/octet-stream", etag: '"strong"', status: 403 },
])("refuses unverifiable binary validators: %j", async (read) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(
      new Response(read.body, {
        status: read.status,
        headers: { "content-type": read.contentType, etag: read.etag },
      }),
    );
  await expect(
    withCssCompatibility(fetcher)("https://pod.example/lock", {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "bytes",
    }),
  ).rejects.toThrow();
});
it("preserves native validators and RDF writes without readback", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 201, headers: { etag: '"native"' } }));
  expect(
    (
      await withCssCompatibility(fetcher)("https://pod.example/r", {
        method: "PUT",
        body: "bytes",
      })
    ).headers.get("etag"),
  ).toBe('"native"');
  expect(fetcher).toHaveBeenCalledOnce();
});

it("gives create-only memory mutexes unique owners and refuses a replacement lock", async () => {
  let stored = new Uint8Array();
  let replace = false;
  const markers: Uint8Array[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "PUT") {
      stored = new Uint8Array(await request.arrayBuffer());
      markers.push(stored);
      return new Response(null, { status: 201 });
    }
    return new Response(Buffer.from(replace ? new Uint8Array(32) : stored), {
      headers: { "content-type": "application/octet-stream", etag: '"version"' },
    });
  };
  const run = () =>
    withCssCompatibility(fetcher)("https://pod.example/private/pkg/mcp/.write-lock", {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "if-none-match": "*" },
      body: "",
    });
  expect((await run()).headers.get("etag")).toBe('"version"');
  replace = true;
  await expect(run()).rejects.toThrow("changed before verification");
  expect(markers[0]).toHaveLength(32);
  expect(markers[0]).not.toEqual(markers[1]);
});

it.each([
  ["<https://pod.example/container/> a <http://www.w3.org/ns/ldp#BasicContainer>.", 412],
  ["<https://other.example/container/> a <http://www.w3.org/ns/ldp#BasicContainer>.", 409],
  ["<https://pod.example/container/> a <https://example.org/Document>.", 409],
  ["not valid Turtle", 409],
])("normalizes only a verified create-only container conflict: %s", async (body, expected) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("conflict", { status: 409 }))
    .mockResolvedValueOnce(new Response(body, { headers: { "content-type": "text/turtle" } }));
  const response = await withCssCompatibility(fetcher)("https://pod.example/container/", {
    method: "PUT",
    headers: { "if-none-match": "*", "content-type": "text/turtle" },
    body: "",
  });
  expect(response.status).toBe(expected);
});
