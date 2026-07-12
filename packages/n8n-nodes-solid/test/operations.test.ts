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

  it("refuses the SLASHLESS pod-base alias as a write target (roborev 13311df)", async () => {
    // `resolveTarget(..., { allowRoot: true })` (the default) treats
    // `https://alice.pod.example/data` (no trailing slash) as the SAME root as
    // the base `https://alice.pod.example/data/` and would accept it as an
    // ordinary in-scope path — widening the write boundary vs the
    // pre-consolidation guard, which rejected this exact form outright. Every
    // WRITE call site now passes `allowRoot: false` to `scopedTarget` to close
    // that gap.
    const { transport, log } = pod();
    const slashlessBase = BASE.slice(0, -1);
    await expect(
      createResource({
        podBaseUrl: BASE,
        target: slashlessBase,
        content: "x",
        contentType: "text/plain",
        request: transport,
      }),
    ).rejects.toThrow(/pod base itself/);
    expect(log).toHaveLength(0); // never issued a request
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

  it("refuses the SLASHLESS pod-base alias as a write target (roborev 13311df)", async () => {
    const { transport, log } = pod();
    await expect(
      updateResource({
        podBaseUrl: BASE,
        target: BASE.slice(0, -1),
        content: "x",
        contentType: "text/plain",
        request: transport,
      }),
    ).rejects.toThrow(/pod base itself/);
    expect(log).toHaveLength(0);
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

  it("refuses the SLASHLESS pod-base alias as a write target (roborev 13311df)", async () => {
    const { transport, log } = pod();
    await expect(
      deleteResource({ podBaseUrl: BASE, target: BASE.slice(0, -1), request: transport }),
    ).rejects.toThrow(/pod base itself/);
    expect(log).toHaveLength(0);
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

describe("redirect refusal (token-leak / pod-escape guard — wave-3 security review)", () => {
  // A poisoned in-pod resource answering `3xx Location: https://evil…` must be
  // REFUSED on every operation: a followed redirect would re-send the Bearer
  // header to the attacker origin (n8n's axios transport forwards credentials on
  // cross-origin redirects by default), and a redirected PUT could steer a write
  // out of the pod. Regression for the wave-3 HIGH finding.
  const Evil = "https://evil.example/steal";

  function redirectingPod(statusCode = 302) {
    return createFakePod({
      base: BASE,
      redirects: {
        "https://alice.pod.example/data/poisoned.ttl": { statusCode, location: Evil },
        "https://alice.pod.example/data/poisoned/": { statusCode, location: Evil },
      },
    });
  }

  it("read: refuses a 302 and never issues a second request", async () => {
    const { transport, log } = redirectingPod();
    await expect(
      readResource({ podBaseUrl: BASE, target: "poisoned.ttl", request: transport }),
    ).rejects.toThrow(/redirect .*refused|refused.*redirect|answered a redirect/);
    expect(log).toHaveLength(1); // the redirect target was never requested
    expect(log[0]?.url).toBe("https://alice.pod.example/data/poisoned.ttl");
  });

  it("create: refuses a 302 on the PUT (a redirected write could escape the pod)", async () => {
    const { transport, log } = redirectingPod();
    await expect(
      createResource({
        podBaseUrl: BASE,
        target: "poisoned.ttl",
        content: "secret payload",
        contentType: "text/plain",
        request: transport,
      }),
    ).rejects.toThrow(/answered a redirect/);
    expect(log).toHaveLength(1);
  });

  it("update: refuses a 307 (method/body-preserving redirect) on the PUT", async () => {
    const { transport, log } = redirectingPod(307);
    await expect(
      updateResource({
        podBaseUrl: BASE,
        target: "poisoned.ttl",
        content: "secret payload",
        contentType: "text/plain",
        request: transport,
      }),
    ).rejects.toThrow(/answered a redirect \(HTTP 307/);
    expect(log).toHaveLength(1);
  });

  it("delete: refuses a 301", async () => {
    const { transport, log } = redirectingPod(301);
    await expect(
      deleteResource({ podBaseUrl: BASE, target: "poisoned.ttl", request: transport }),
    ).rejects.toThrow(/answered a redirect \(HTTP 301/);
    expect(log).toHaveLength(1);
  });

  it("list: refuses a 302 on the container GET", async () => {
    const { transport, log } = redirectingPod();
    await expect(
      listContainer({ podBaseUrl: BASE, target: "poisoned/", request: transport }),
    ).rejects.toThrow(/answered a redirect/);
    expect(log).toHaveLength(1);
  });

  it("echoes the redirect Location with userinfo REDACTED (continueOnFail surfaces it)", async () => {
    const { transport } = createFakePod({
      base: BASE,
      redirects: {
        "https://alice.pod.example/data/poisoned.ttl": {
          location: "https://alice:s3cr3t-p4ss@evil.example/steal",
        },
      },
    });
    let message = "";
    try {
      await readResource({ podBaseUrl: BASE, target: "poisoned.ttl", request: transport });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/answered a redirect/);
    expect(message).toContain("//<redacted>@evil.example/steal");
    expect(message).not.toContain("s3cr3t-p4ss");
  });
});
