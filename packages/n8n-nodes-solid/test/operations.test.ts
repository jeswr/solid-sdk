// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Operation tests driven against the Map-backed fake pod (test/fake-pod.ts) —
// every Read/Create/Update/Delete + Container List path, plus the scope-guard
// refusals and the conditional-write preconditions, WITHOUT a real server.

import { describe, expect, it } from "vitest";
import {
  createResource,
  deleteResource,
  listContainer,
  readResource,
  scopedTarget,
  updateResource,
} from "../nodes/Solid/operations.js";
import { createFakePod } from "./fake-pod.js";

const BASE = "https://alice.pod.example/data/";

function pod() {
  return createFakePod({ base: BASE });
}

describe("scopedTarget", () => {
  it("resolves a relative target to an absolute pod URL", () => {
    expect(scopedTarget(BASE, "a/b.ttl").url).toBe("https://alice.pod.example/data/a/b.ttl");
  });
  it("refuses an out-of-pod target", () => {
    expect(() => scopedTarget(BASE, "https://evil.example/x")).toThrow(/escapes pod/);
  });
});

describe("createResource", () => {
  it("creates a new resource (201) and stores the body + content-type", async () => {
    const { transport, store } = pod();
    const res = await createResource({
      podBaseUrl: BASE,
      target: "notes/a.ttl",
      content: "<#a> <#b> <#c> .",
      contentType: "text/turtle",
      request: transport,
    });
    expect(res.created).toBe(true);
    const stored = store.get("https://alice.pod.example/data/notes/a.ttl");
    expect(stored?.body).toBe("<#a> <#b> <#c> .");
    expect(stored?.contentType).toBe("text/turtle");
  });

  it("refuses to overwrite an existing resource (412 -> error)", async () => {
    const { transport } = pod();
    const input = {
      podBaseUrl: BASE,
      target: "notes/a.ttl",
      content: "first",
      contentType: "text/plain",
      request: transport,
    };
    await createResource(input);
    await expect(createResource(input)).rejects.toThrow(/already exists/);
  });

  it("refuses a container target", async () => {
    const { transport } = pod();
    await expect(
      createResource({
        podBaseUrl: BASE,
        target: "notes/",
        content: "x",
        contentType: "text/plain",
        request: transport,
      }),
    ).rejects.toThrow(/is a container/);
  });

  it("refuses an out-of-pod target (scope guard) before any request", async () => {
    const { transport, log } = pod();
    await expect(
      createResource({
        podBaseUrl: BASE,
        target: "https://evil.example/x",
        content: "x",
        contentType: "text/plain",
        request: transport,
      }),
    ).rejects.toThrow(/escapes pod/);
    expect(log).toHaveLength(0); // never issued a request to the foreign host
  });
});

describe("readResource", () => {
  it("reads a stored resource's body, content-type and etag", async () => {
    const { transport } = pod();
    await createResource({
      podBaseUrl: BASE,
      target: "notes/a.ttl",
      content: "hello",
      contentType: "text/plain",
      request: transport,
    });
    const res = await readResource({ podBaseUrl: BASE, target: "notes/a.ttl", request: transport });
    expect(res.body).toBe("hello");
    expect(res.contentType).toBe("text/plain");
    expect(typeof res.etag).toBe("string");
  });

  it("throws on a 404", async () => {
    const { transport } = pod();
    await expect(
      readResource({ podBaseUrl: BASE, target: "missing.ttl", request: transport }),
    ).rejects.toThrow(/read .* failed: HTTP 404/);
  });
});

describe("updateResource", () => {
  it("creates or overwrites a resource (unconditional)", async () => {
    const { transport, store } = pod();
    await updateResource({
      podBaseUrl: BASE,
      target: "x.ttl",
      content: "v1",
      contentType: "text/plain",
      request: transport,
    });
    await updateResource({
      podBaseUrl: BASE,
      target: "x.ttl",
      content: "v2",
      contentType: "text/plain",
      request: transport,
    });
    expect(store.get("https://alice.pod.example/data/x.ttl")?.body).toBe("v2");
  });

  it("honours an If-Match ETag (matching tag succeeds)", async () => {
    const { transport } = pod();
    await createResource({
      podBaseUrl: BASE,
      target: "x.ttl",
      content: "v1",
      contentType: "text/plain",
      request: transport,
    });
    const read = await readResource({ podBaseUrl: BASE, target: "x.ttl", request: transport });
    const res = await updateResource({
      podBaseUrl: BASE,
      target: "x.ttl",
      content: "v2",
      contentType: "text/plain",
      ifMatch: read.etag as string,
      request: transport,
    });
    expect(res.updated).toBe(true);
  });

  it("fails an If-Match with a stale ETag (412)", async () => {
    const { transport } = pod();
    await createResource({
      podBaseUrl: BASE,
      target: "x.ttl",
      content: "v1",
      contentType: "text/plain",
      request: transport,
    });
    await expect(
      updateResource({
        podBaseUrl: BASE,
        target: "x.ttl",
        content: "v2",
        contentType: "text/plain",
        ifMatch: '"stale-etag"',
        request: transport,
      }),
    ).rejects.toThrow(/precondition failed/);
  });
});

describe("deleteResource", () => {
  it("deletes a stored resource", async () => {
    const { transport, store } = pod();
    await createResource({
      podBaseUrl: BASE,
      target: "x.ttl",
      content: "v1",
      contentType: "text/plain",
      request: transport,
    });
    const res = await deleteResource({ podBaseUrl: BASE, target: "x.ttl", request: transport });
    expect(res.deleted).toBe(true);
    expect(store.has("https://alice.pod.example/data/x.ttl")).toBe(false);
  });

  it("reports notFound on a 404 rather than throwing", async () => {
    const { transport } = pod();
    const res = await deleteResource({
      podBaseUrl: BASE,
      target: "missing.ttl",
      request: transport,
    });
    expect(res).toMatchObject({ deleted: false, notFound: true });
  });
});

describe("listContainer", () => {
  it("lists the direct ldp:contains members of a container", async () => {
    const { transport } = pod();
    for (const name of ["notes/a.ttl", "notes/b.ttl"]) {
      await createResource({
        podBaseUrl: BASE,
        target: name,
        content: "x",
        contentType: "text/plain",
        request: transport,
      });
    }
    const { members, containerUrl } = await listContainer({
      podBaseUrl: BASE,
      target: "notes/",
      request: transport,
    });
    expect(containerUrl).toBe("https://alice.pod.example/data/notes/");
    expect(members.map((m) => m.url).sort()).toEqual([
      "https://alice.pod.example/data/notes/a.ttl",
      "https://alice.pod.example/data/notes/b.ttl",
    ]);
    expect(members.map((m) => m.name).sort()).toEqual(["a.ttl", "b.ttl"]);
  });

  it("treats a target without a trailing slash as a container", async () => {
    const { transport, log } = pod();
    await createResource({
      podBaseUrl: BASE,
      target: "notes/a.ttl",
      content: "x",
      contentType: "text/plain",
      request: transport,
    });
    log.length = 0;
    const { containerUrl } = await listContainer({
      podBaseUrl: BASE,
      target: "notes",
      request: transport,
    });
    expect(containerUrl).toBe("https://alice.pod.example/data/notes/");
    // The GET was issued against the trailing-slash container URL.
    expect(log[0]?.url).toBe("https://alice.pod.example/data/notes/");
  });

  it("returns an empty list for a missing container (404)", async () => {
    const { transport } = pod();
    const { members } = await listContainer({
      podBaseUrl: BASE,
      target: "empty/",
      request: transport,
    });
    expect(members).toEqual([]);
  });

  it("refuses an out-of-pod container target", async () => {
    const { transport } = pod();
    await expect(
      listContainer({ podBaseUrl: BASE, target: "https://evil.example/c/", request: transport }),
    ).rejects.toThrow(/escapes pod/);
  });
});
