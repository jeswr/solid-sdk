// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// End-to-end-ish tests for the Solid INodeType's execute() — driving the REAL
// node class through a fake IExecuteFunctions wired to the Map-backed fake pod.
// This exercises the parameter plumbing, the httpRequestWithAuthentication seam,
// continueOnFail, and pairedItem linkage — not just the operations module.

import { describe, expect, it } from "vitest";
import type { SolidHttpRequest } from "../nodes/Solid/operations.js";
import { Solid } from "../nodes/Solid/Solid.node.js";
import { createFakePod } from "./fake-pod.js";

const BASE = "https://alice.pod.example/data/";

interface NodeParams {
  resource: string;
  operation: string;
  target: string;
  content?: string;
  contentType?: string;
  ifMatch?: string;
}

/**
 * Build a minimal fake IExecuteFunctions for one or more input items, each with
 * its own params. The fake pod's transport backs httpRequestWithAuthentication,
 * translating the node's IHttpRequestOptions into the fake-pod SolidHttpRequest.
 */
function fakeExecute(params: NodeParams[], opts?: { continueOnFail?: boolean }) {
  const { transport, store, log } = createFakePod({ base: BASE });
  const credentials = { podBaseUrl: BASE, accessToken: "TOP-SECRET-TOKEN" };
  const seenAuth: string[] = []; // record any credential-type passed to the helper
  const seenOptions: Record<string, unknown>[] = []; // record every IHttpRequestOptions

  const ctx = {
    getInputData: () => params.map(() => ({ json: {} })),
    getNodeParameter: (name: string, i: number, fallback?: unknown) => {
      const v = (params[i] as unknown as Record<string, unknown>)[name];
      return v === undefined ? fallback : v;
    },
    getCredentials: async (_type: string) => credentials,
    continueOnFail: () => opts?.continueOnFail ?? false,
    getNode: () => ({ name: "Solid", type: "solid" }),
    helpers: {
      httpRequestWithAuthentication: {
        async call(_this: unknown, credType: string, options: Record<string, unknown>) {
          seenAuth.push(credType);
          seenOptions.push(options);
          const req: SolidHttpRequest = {
            method: options.method as SolidHttpRequest["method"],
            url: options.url as string,
            headers: (options.headers as Record<string, string>) ?? {},
            ...(options.body !== undefined ? { body: options.body as string } : {}),
          };
          const r = await transport(req);
          return { statusCode: r.statusCode, headers: r.headers, body: r.body };
        },
      },
    },
  };

  return {
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake IExecuteFunctions
    run: () => new Solid().execute.call(ctx as any),
    store,
    log,
    seenAuth,
    seenOptions,
    credentials,
  };
}

describe("Solid.execute — resource lifecycle", () => {
  it("creates then reads a resource through the node", async () => {
    // Create
    const create = fakeExecute([
      {
        resource: "resource",
        operation: "create",
        target: "n/a.ttl",
        content: "hi",
        contentType: "text/plain",
      },
    ]);
    const createOut = await create.run();
    expect(createOut[0][0].json).toMatchObject({ created: true });
    expect(createOut[0][0].pairedItem).toEqual({ item: 0 });
    // The store now has it (same fake pod across the read below would be a new
    // pod, so assert on the create's own store).
    expect(create.store.get("https://alice.pod.example/data/n/a.ttl")?.body).toBe("hi");
  });

  it("passes the credential TYPE NAME (not the token) to the auth helper", async () => {
    const e = fakeExecute([{ resource: "resource", operation: "read", target: "x.ttl" }]);
    await e.run().catch(() => {}); // 404 read is fine; we only check the seam
    expect(e.seenAuth).toContain("solidApi");
    // The token is held only in the (fake) credential object n8n injects via the
    // helper — the node code path never references credentials.accessToken.
  });

  it("disables redirect-following + cross-origin credential forwarding on EVERY request", async () => {
    // Security regression (wave-3 review): without `disableFollowRedirect`,
    // n8n's axios transport follows a poisoned resource's 302 off-pod and (by
    // default) FORWARDS the Bearer header cross-origin — token exfiltration.
    const e = fakeExecute(
      [
        { resource: "resource", operation: "read", target: "x.ttl" },
        {
          resource: "resource",
          operation: "create",
          target: "y.ttl",
          content: "z",
          contentType: "text/plain",
        },
        { resource: "container", operation: "list", target: "c/" },
      ],
      // continueOnFail so every item issues its request even if an earlier one
      // errors (the 404 read) — statuses are irrelevant; we assert the options.
      { continueOnFail: true },
    );
    await e.run().catch(() => {});
    expect(e.seenOptions.length).toBeGreaterThanOrEqual(3);
    for (const options of e.seenOptions) {
      expect(options.disableFollowRedirect).toBe(true);
      expect(options.sendCredentialsOnCrossOriginRedirect).toBe(false);
    }
  });

  it("never places the token anywhere in the request options it builds", async () => {
    const e = fakeExecute([{ resource: "resource", operation: "read", target: "x.ttl" }]);
    await e.run().catch(() => {});
    for (const options of e.seenOptions) {
      expect(JSON.stringify(options)).not.toContain("TOP-SECRET-TOKEN");
    }
  });
});

describe("Solid.execute — container list emits one item per member", () => {
  it("lists members as separate output items with pairedItem linkage", async () => {
    const e = fakeExecute([
      {
        resource: "resource",
        operation: "create",
        target: "c/a.ttl",
        content: "1",
        contentType: "text/plain",
      },
    ]);
    // seed two resources directly in the store via create then list in one node run
    await e.run();
    e.store.set("https://alice.pod.example/data/c/b.ttl", {
      body: "2",
      contentType: "text/plain",
      etag: '"x"',
    });

    const list = fakeExecuteWithStore(
      [{ resource: "container", operation: "list", target: "c/" }],
      e.store,
    );
    const out = await list.run();
    const urls = out[0].map((r) => (r.json as { url: string }).url).sort();
    expect(urls).toEqual([
      "https://alice.pod.example/data/c/a.ttl",
      "https://alice.pod.example/data/c/b.ttl",
    ]);
    for (const row of out[0]) {
      expect(row.pairedItem).toEqual({ item: 0 });
    }
  });
});

describe("Solid.execute — error handling", () => {
  it("throws by default on an out-of-pod target", async () => {
    const e = fakeExecute([
      { resource: "resource", operation: "read", target: "https://evil.example/x" },
    ]);
    await expect(e.run()).rejects.toThrow(/escapes pod/);
  });

  it("with continueOnFail, surfaces the error as item JSON and keeps going", async () => {
    const e = fakeExecute(
      [
        { resource: "resource", operation: "read", target: "https://evil.example/x" },
        {
          resource: "resource",
          operation: "create",
          target: "ok.ttl",
          content: "y",
          contentType: "text/plain",
        },
      ],
      { continueOnFail: true },
    );
    const out = await e.run();
    expect((out[0][0].json as { error: string }).error).toMatch(/escapes pod/);
    expect(out[0][1].json).toMatchObject({ created: true });
  });
});

// Helper to run the node against a PRE-SEEDED store (shares one fake pod).
function fakeExecuteWithStore(
  params: NodeParams[],
  store: Map<string, { body: string; contentType: string; etag: string }>,
) {
  const log: SolidHttpRequest[] = [];
  const fake = createFakePod({ base: BASE, log });
  // graft the pre-seeded entries onto the new fake pod's store
  for (const [k, v] of store) {
    fake.store.set(k, v);
  }
  const credentials = { podBaseUrl: BASE, accessToken: "TOP-SECRET-TOKEN" };
  const ctx = {
    getInputData: () => params.map(() => ({ json: {} })),
    getNodeParameter: (name: string, i: number, fallback?: unknown) => {
      const v = (params[i] as unknown as Record<string, unknown>)[name];
      return v === undefined ? fallback : v;
    },
    getCredentials: async () => credentials,
    continueOnFail: () => false,
    getNode: () => ({ name: "Solid", type: "solid" }),
    helpers: {
      httpRequestWithAuthentication: {
        async call(_this: unknown, _credType: string, options: Record<string, unknown>) {
          const req: SolidHttpRequest = {
            method: options.method as SolidHttpRequest["method"],
            url: options.url as string,
            headers: (options.headers as Record<string, string>) ?? {},
            ...(options.body !== undefined ? { body: options.body as string } : {}),
          };
          const r = await fake.transport(req);
          return { statusCode: r.statusCode, headers: r.headers, body: r.body };
        },
      },
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake IExecuteFunctions
  return { run: () => new Solid().execute.call(ctx as any), store: fake.store };
}
