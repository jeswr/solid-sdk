// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import {
  ContactsTransport,
  MAX_RDF_BYTES,
  MAX_RDF_QUADS,
  replacement,
} from "../src/apps/contacts/lib/model/transport";
import { ALICE, MemoryPod, parse, ROOT } from "./contacts-support";

describe("contacts injected transport", () => {
  test("requires preconditions on deletion and rejects malformed ETags before writes", async () => {
    const pod = new MemoryPod();
    const transport = new ContactsTransport(ROOT, pod.fetch);
    await expect(transport.commit([{ url: ALICE, etag: null }])).rejects.toThrow(
      "Deletion requires",
    );
    for (const etag of ["*", 'W/"weak"', "", '"injected"\r\nHeader: x']) {
      await expect(transport.commit([{ url: ALICE, dataset: new Store(), etag }])).rejects.toThrow(
        "strong ETag",
      );
    }
    expect(pod.requests).toHaveLength(0);
    expect(() => replacement({ url: ALICE, etag: null, data: null, dataset: new Store() })).toThrow(
      "strong ETag",
    );
  });

  test("preflights all URLs before the first write and refuses authenticated redirect hops", async () => {
    const pod = new MemoryPod();
    const transport = new ContactsTransport(ROOT, pod.fetch);
    await expect(
      transport.commit([
        { url: ALICE, dataset: new Store(), etag: null },
        { url: "https://evil.example/x", dataset: new Store(), etag: null },
      ]),
    ).rejects.toThrow();
    expect(pod.requests).toHaveLength(0);
    pod.fail = () => new Response(null, { status: 303, headers: { location: `${ROOT}elsewhere` } });
    await expect(
      transport.commit([{ url: ALICE, dataset: new Store(), etag: null }]),
    ).rejects.toThrow("redirect");
    expect(pod.requests).toHaveLength(1);
  });

  test("retains absent response ETags and propagates network failures and partial writes", async () => {
    let calls = 0;
    const transport = new ContactsTransport(ROOT, async () => {
      calls++;
      return new Response(null, { status: 204 });
    });
    expect(await transport.commit([{ url: ALICE, dataset: new Store(), etag: null }])).toEqual([
      null,
    ]);
    expect(calls).toBe(1);
    const network = new ContactsTransport(ROOT, async () => {
      throw new Error("offline");
    });
    await expect(
      network.commit([{ url: ALICE, dataset: new Store(), etag: null }]),
    ).rejects.toThrow("offline");
    expect(await transport.commit([])).toEqual([]);
  });
});

test("refuses JSON-LD before remote contexts can bypass the injected transport", async () => {
  const globalFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected global fetch"));
  try {
    for (const context of ["https://evil.example/context", `${ROOT}context`]) {
      const injected = vi.fn<typeof fetch>(async (_input, init) => {
        expect(new Headers(init?.headers).get("accept")).toBe("text/turtle");
        return new Response(JSON.stringify({ "@context": context, "@id": `${ALICE}#this` }), {
          headers: { "content-type": "Application/LD+JSON; charset=utf-8" },
        });
      });
      const transport = new ContactsTransport(ROOT, injected);
      await expect(transport.read(ALICE, (dataset) => dataset)).rejects.toThrow(
        "JSON-LD is unsupported",
      );
      expect(injected).toHaveBeenCalledTimes(1);
      expect(globalFetch).not.toHaveBeenCalled();
    }
  } finally {
    globalFetch.mockRestore();
  }
});

test.each([
  undefined,
  "1",
  String(MAX_RDF_BYTES + 1),
])("bounds response bytes with absent, false or oversized length: %s", async (length) => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      // Invalid RDF proves rejection happens before the parser is called.
      controller.enqueue(new Uint8Array(MAX_RDF_BYTES / 2 + 1).fill(33));
    },
    cancel() {
      cancelled = true;
    },
  });
  const parse = vi.fn();
  const transport = new ContactsTransport(
    ROOT,
    async () =>
      new Response(stream, {
        headers: {
          "content-type": "text/turtle",
          ...(length === undefined ? {} : { "content-length": length }),
        },
      }),
  );
  await expect(transport.read(ALICE, parse)).rejects.toThrow("byte limit");
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThanOrEqual(3);
  expect(parse).not.toHaveBeenCalled();
});

test("rejects excessive datasets before application accessors run", async () => {
  const body = `<#it> <https://example.org/value> ${Array.from({ length: MAX_RDF_QUADS + 1 }, (_, i) => `"${i}"`).join(",")} .`;
  expect(new TextEncoder().encode(body).length).toBeLessThan(MAX_RDF_BYTES);
  const transport = new ContactsTransport(
    ROOT,
    async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  );
  const parse = vi.fn();
  await expect(transport.read(ALICE, parse)).rejects.toThrow("quad limit");
  expect(parse).not.toHaveBeenCalled();
});

test("cancels a stalled response body and never parses after cancellation", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const transport = new ContactsTransport(
    ROOT,
    async () =>
      new Response(
        new ReadableStream({
          start() {
            queueMicrotask(() => controller.abort(new Error("cancelled body")));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const parse = vi.fn();
  await expect(transport.read(ALICE, parse, controller.signal)).rejects.toThrow("cancelled body");
  expect(cancelled).toBe(true);
  expect(parse).not.toHaveBeenCalled();
});

test("aborts a pending stream read even when the injected response ignores the signal", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        controller.abort(new Error("pending read cancelled"));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const transport = new ContactsTransport(ROOT, async () => new Response(body));
  await expect(transport.read(ALICE, (dataset) => dataset, controller.signal)).rejects.toThrow(
    "pending read cancelled",
  );
  expect(cancelled).toBe(true);
});

test("accepts a bodyless successful RDF response", async () => {
  const transport = new ContactsTransport(ROOT, async () => new Response(null, { status: 204 }));
  expect((await transport.read(ALICE, (dataset) => dataset.size)).data).toBe(0);
});

// AUTHORED-BY Codex GPT-6
test.each([
  null,
  '"1"',
])("preflights every outgoing dataset's quad count before writes (etag %s)", async (etag) => {
  const dataset = await parse(
    `<#it> <https://example.org/value> ${Array.from({ length: MAX_RDF_QUADS + 1 }, (_, i) => `"${i}"`).join(",")} .`,
    ALICE,
  );
  const pod = new MemoryPod();
  const transport = new ContactsTransport(ROOT, pod.fetch);
  expect(dataset.size).toBe(MAX_RDF_QUADS + 1);
  await expect(
    transport.commit([
      { url: `${ROOT}first.ttl`, dataset: new Store(), etag: null },
      { url: ALICE, dataset, etag },
    ]),
  ).rejects.toThrow("quad limit");
  expect(pod.requests).toHaveLength(0);
});

test.each([
  null,
  '"1"',
])("preflights serialized UTF-8 bytes before writes (etag %s)", async (etag) => {
  const dataset = await parse(
    `<#it> <https://example.org/value> "${"é".repeat(MAX_RDF_BYTES / 2)}" .`,
    ALICE,
  );
  const body = await serialize([...dataset]);
  expect(dataset.size).toBe(1);
  expect(body.length).toBeLessThan(MAX_RDF_BYTES);
  expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(MAX_RDF_BYTES);
  const pod = new MemoryPod();
  const transport = new ContactsTransport(ROOT, pod.fetch);
  await expect(
    transport.commit([
      { url: `${ROOT}first.ttl`, dataset: new Store(), etag: null },
      { url: ALICE, dataset, etag },
    ]),
  ).rejects.toThrow("byte limit");
  expect(pod.requests).toHaveLength(0);
});

test("accepts writes at the quad and serialized UTF-8 byte limits and reads them back", async () => {
  const quads = await parse(
    `<#it> <https://example.org/value> ${Array.from({ length: MAX_RDF_QUADS }, (_, i) => `"${i}"`).join(",")} .`,
    ALICE,
  );
  const bytesUrl = `${ROOT}bytes.ttl`;
  const empty = await parse('<#it> <https://example.org/value> "" .', bytesUrl);
  const overhead = new TextEncoder().encode(await serialize([...empty])).byteLength;
  const bytes = await parse(
    `<#it> <https://example.org/value> "${"é".repeat((MAX_RDF_BYTES - overhead) / 2)}${"a".repeat((MAX_RDF_BYTES - overhead) % 2)}" .`,
    bytesUrl,
  );
  expect(quads.size).toBe(MAX_RDF_QUADS);
  expect(new TextEncoder().encode(await serialize([...bytes])).byteLength).toBe(MAX_RDF_BYTES);
  const pod = new MemoryPod();
  const transport = new ContactsTransport(ROOT, pod.fetch);
  await transport.commit([
    { url: ALICE, dataset: quads, etag: null },
    { url: bytesUrl, dataset: bytes, etag: null },
  ]);
  expect(pod.writes).toHaveLength(2);
  expect((await transport.read(ALICE, (dataset) => dataset.size)).data).toBe(MAX_RDF_QUADS);
  expect((await transport.read(bytesUrl, (dataset) => dataset.size)).data).toBe(1);
});
