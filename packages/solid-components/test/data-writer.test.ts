// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DataWriter write-auth + scope-guard tests (the SECURITY-critical write surface):
//   - the lost-update guard: an UPDATE of an existing resource is a conditional
//     If-Match PUT; an UNCONDITIONAL overwrite is REFUSED (fail-closed);
//   - the §10 merge save reads the existing graph + writes back with If-Match;
//   - a 404 pre-read → a CREATE-ONLY (If-None-Match:*) write;
//   - a 412/409/428 → WriteConflictError; other non-2xx → WriteFailedError;
//   - the scope guard rejects a cross-origin / non-http / path-escape / embedded-
//     credentials target BEFORE any fetch fires (fail-closed).

import type { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  DataWriter,
  UnconditionalOverwriteError,
  WriteConflictError,
  WriteFailedError,
  WriteScopeError,
} from "../src/data-writer.js";
import { parseTurtle } from "./fixtures.js";

const TURTLE = "text/turtle";

/** A 200 Turtle response with an optional ETag (the existing resource for a merge). */
function ttlRes(body: string, etag?: string): Response {
  const headers = new Headers();
  headers.set("Content-Type", TURTLE);
  if (etag) headers.set("ETag", etag);
  return new Response(body, { status: 200, headers });
}

/** A status-only response (no body) the writer reads .status/.ok/.headers off. */
function statusRes(status: number, etag?: string): Response {
  const headers = new Headers();
  if (etag) headers.set("ETag", etag);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body: null,
    text: async () => "",
  } as unknown as Response;
}

const TASK_BODY = `
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct: <http://purl.org/dc/terms/> .
<https://alice.example/tasks/1#it> a wf:Task ; dct:title "Original" .
`;

/** A trivial mutator that sets dct:title via a raw quad (test-only; not a model). */
function setTitle(value: string) {
  return (graph: Store): undefined => {
    const subj = "https://alice.example/tasks/1#it";
    const titlePred = "http://purl.org/dc/terms/title";
    for (const q of graph.getQuads(subj, titlePred, null, null)) graph.removeQuad(q);
    graph.addQuad(
      { termType: "NamedNode", value: subj } as never,
      { termType: "NamedNode", value: titlePred } as never,
      {
        termType: "Literal",
        value,
        language: "",
        datatype: { termType: "NamedNode", value: "http://www.w3.org/2001/XMLSchema#string" },
      } as never,
    );
    return undefined;
  };
}

describe("DataWriter.saveMerged — conditional, merge-not-replace", () => {
  it("UPDATE: pre-reads the existing resource, then PUTs with If-Match (the etag)", async () => {
    const calls: { method: string; headers: Record<string, string>; body?: string }[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as string | undefined,
      });
      if (method === "GET") return ttlRes(TASK_BODY, '"v1"');
      return statusRes(205, '"v2"'); // PUT ok (205 No Content-ish; ok)
    });
    const dw = new DataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });

    const result = await dw.saveMerged("https://alice.example/tasks/1", setTitle("Edited"));

    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("PUT");
    // The lost-update guard: the PUT carries If-Match with the read etag.
    expect(calls[1].headers["If-Match"]).toBe('"v1"');
    expect(calls[1].headers["Content-Type"]).toBe(TURTLE);
    // The merged body preserved the type + carries the edited title.
    expect(calls[1].body).toContain("flow#Task");
    expect(calls[1].body).toContain("Edited");
    expect(result.etag).toBe('"v2"');
  });

  it("CREATE: a 404 pre-read → an If-None-Match:* create-only write (no merge)", async () => {
    const calls: { method: string; headers: Record<string, string> }[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, headers: (init?.headers as Record<string, string>) ?? {} });
      if (method === "GET") return statusRes(404);
      return statusRes(201, '"new"');
    });
    const dw = new DataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });

    await dw.saveMerged("https://alice.example/tasks/new", setTitle("Fresh"));
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].headers["If-None-Match"]).toBe("*");
    expect(calls[1].headers["If-Match"]).toBeUndefined();
  });

  it("FAIL-CLOSED: an existing resource served with NO ETag refuses to overwrite", async () => {
    // The pre-read succeeds but the server sent no ETag → we cannot do a conditional
    // update, so saveMerged must refuse rather than do an unconditional PUT.
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return ttlRes(TASK_BODY); // no etag
      return statusRes(205);
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(UnconditionalOverwriteError);
    // The PUT never fired (only the pre-read GET).
    expect(fetch.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "PUT")).toHaveLength(0);
  });

  it("a 412 on the conditional PUT → WriteConflictError (lost-update guard fired)", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return ttlRes(TASK_BODY, '"v1"');
      return statusRes(412);
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(WriteConflictError);
  });

  it("a 500 on the PUT → WriteFailedError", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return ttlRes(TASK_BODY, '"v1"');
      return statusRes(500);
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(WriteFailedError);
  });

  it("createIfAbsent:false on a 404 → WriteFailedError (no create)", async () => {
    const fetch = vi.fn(async () => statusRes(404));
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(
      dw.saveMerged("https://alice.example/tasks/x", setTitle("X"), { createIfAbsent: false }),
    ).rejects.toBeInstanceOf(WriteFailedError);
  });

  it("sets redirect:error on the pre-read GET AND the PUT (redirect-SSRF guard)", async () => {
    // roborev HIGH regression: `fetch` follows redirects by default, so a scoped write
    // could be 307/308-redirected off-scope. Every writer fetch must set redirect:error.
    const seen: { method: string; redirect?: string }[] = [];
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", redirect: init?.redirect });
      if ((init?.method ?? "GET") === "GET") return ttlRes(TASK_BODY, '"v1"');
      return statusRes(205, '"v2"');
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await dw.saveMerged("https://alice.example/tasks/1", setTitle("X"));
    const get = seen.find((s) => s.method === "GET");
    const put = seen.find((s) => s.method === "PUT");
    expect(get?.redirect).toBe("error");
    expect(put?.redirect).toBe("error");
  });

  it("a redirected pre-read whose final URL is off-scope is REFUSED (belt-and-braces)", async () => {
    // A non-spec fetch impl that doesn't honour redirect:error but surfaces a foreign
    // response.url must still be rejected — the merge base can't be off-scope.
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        // A 200 whose final URL is a DIFFERENT origin (a followed redirect).
        const headers = new Headers();
        headers.set("Content-Type", TURTLE);
        headers.set("ETag", '"v1"');
        return {
          status: 200,
          ok: true,
          url: "https://evil.example/tasks/1",
          headers,
          body: null,
          text: async () => TASK_BODY,
        } as unknown as Response;
      }
      return statusRes(205, '"v2"');
    });
    const dw = new DataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });
    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(WriteScopeError);
    // The PUT never fired (the off-scope final URL was caught after the read).
    expect(fetch.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "PUT")).toHaveLength(0);
  });

  it("an OFF-SCOPE 404 pre-read FAILS CLOSED (not treated as 'missing' → create)", async () => {
    // roborev round-2 MEDIUM: a redirected GET that 404s at a FOREIGN origin must not
    // be read as "the scoped resource is absent" and proceed to a create-only PUT —
    // the scope re-check must precede the 404/410 branch.
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        const headers = new Headers();
        return {
          status: 404,
          ok: false,
          url: "https://evil.example/tasks/1", // off-scope final URL on a 404.
          headers,
          body: null,
          text: async () => "",
        } as unknown as Response;
      }
      return statusRes(201, '"new"');
    });
    const dw = new DataWriter({
      fetch: fetch as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });
    await expect(
      dw.saveMerged("https://alice.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(WriteScopeError);
    // No create-only PUT fired.
    expect(fetch.mock.calls.filter((c) => (c[1] as RequestInit)?.method === "PUT")).toHaveLength(0);
  });

  it("delete sets redirect:error too", async () => {
    let deleteRedirect: string | undefined;
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "DELETE") deleteRedirect = init?.redirect;
      return statusRes(205);
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await dw.delete("https://alice.example/x", { ifMatch: '"v1"' });
    expect(deleteRedirect).toBe("error");
  });
});

describe("DataWriter.putTurtle — the explicit conditional write", () => {
  it("REFUSES an unconditional PUT (fail-closed lost-update guard)", async () => {
    const fetch = vi.fn(async () => statusRes(205));
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dw.putTurtle("https://alice.example/x", "<a> <b> <c> .")).rejects.toBeInstanceOf(
      UnconditionalOverwriteError,
    );
    expect(fetch).not.toHaveBeenCalled(); // never reached the network.
  });

  it("allows a conditional If-Match PUT", async () => {
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["If-Match"]).toBe('"v1"');
      return statusRes(205, '"v2"');
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    const r = await dw.putTurtle("https://alice.example/x", "<a> <b> <c> .", { ifMatch: '"v1"' });
    expect(r.etag).toBe('"v2"');
  });

  it("rejects passing BOTH ifMatch and ifNoneMatch", async () => {
    const fetch = vi.fn(async () => statusRes(205));
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(
      dw.putTurtle("https://alice.example/x", "<a> <b> <c> .", {
        ifMatch: '"v1"',
        ifNoneMatch: "*",
      }),
    ).rejects.toThrow(/at most one/i);
  });
});

describe("DataWriter scope guard (fail-closed, BEFORE any fetch)", () => {
  const fetch = vi.fn(async () => ttlRes(TASK_BODY, '"v1"'));
  function dw(base?: string) {
    return new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch, base });
  }

  it("refuses a cross-ORIGIN target", async () => {
    fetch.mockClear();
    await expect(
      dw("https://alice.example/tasks/").saveMerged("https://evil.example/tasks/1", setTitle("X")),
    ).rejects.toBeInstanceOf(WriteScopeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a path OUTSIDE the base directory (a prefix-string trick)", async () => {
    fetch.mockClear();
    // `…/tasks-evil/` shares the `…/tasks` STRING prefix but is a sibling, not under
    // the `…/tasks/` directory — must be rejected.
    await expect(
      dw("https://alice.example/tasks/").saveMerged(
        "https://alice.example/tasks-evil/1",
        setTitle("X"),
      ),
    ).rejects.toBeInstanceOf(WriteScopeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a non-http(s) scheme + embedded credentials", async () => {
    fetch.mockClear();
    await expect(dw().saveMerged("ftp://alice.example/x", setTitle("X"))).rejects.toBeInstanceOf(
      WriteScopeError,
    );
    await expect(
      dw().saveMerged("https://user:pass@alice.example/x", setTitle("X")),
    ).rejects.toBeInstanceOf(WriteScopeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ALLOWS a target at/under the base directory", async () => {
    fetch.mockClear();
    const dwScoped = new DataWriter({
      fetch: (async (_u: string, init?: RequestInit) =>
        (init?.method ?? "GET") === "GET"
          ? ttlRes(TASK_BODY, '"v1"')
          : statusRes(205, '"v2"')) as unknown as typeof globalThis.fetch,
      base: "https://alice.example/tasks/",
    });
    const r = await dwScoped.saveMerged("https://alice.example/tasks/1", setTitle("X"));
    expect(r.url).toBe("https://alice.example/tasks/1");
  });
});

describe("DataWriter.delete — conditional", () => {
  it("requires If-Match", async () => {
    const fetch = vi.fn(async () => statusRes(205));
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    // @ts-expect-error — deliberately omit the required ifMatch to prove the guard.
    await expect(dw.delete("https://alice.example/x", {})).rejects.toBeInstanceOf(
      UnconditionalOverwriteError,
    );
  });

  it("sends If-Match + tolerates a 404 (already gone)", async () => {
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["If-Match"]).toBe('"v1"');
      return statusRes(404);
    });
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(
      dw.delete("https://alice.example/x", { ifMatch: '"v1"' }),
    ).resolves.toBeUndefined();
  });

  it("a 412 delete → WriteConflictError", async () => {
    const fetch = vi.fn(async () => statusRes(412));
    const dw = new DataWriter({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dw.delete("https://alice.example/x", { ifMatch: '"v1"' })).rejects.toBeInstanceOf(
      WriteConflictError,
    );
  });
});

// A sanity check that the test mutator + parse helper actually wire up (so the merge
// tests above exercise a real graph mutation, not a no-op).
describe("test scaffolding sanity", () => {
  it("the setTitle mutator replaces dct:title on a parsed graph", () => {
    const g = parseTurtle(TASK_BODY, "https://alice.example/tasks/1");
    setTitle("Edited")(g);
    const titles = g.getObjects(
      "https://alice.example/tasks/1#it",
      "http://purl.org/dc/terms/title",
      null,
    );
    expect(titles.map((t) => t.value)).toEqual(["Edited"]);
  });
});
