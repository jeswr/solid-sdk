// AUTHORED-BY Claude Opus 5.5
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../pod/resource.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { ImportContext, IntegrationAdapter, PodWriter } from "./types.js";

const ROOT = `${TEST_POD_ROOT}integrations/toy/`;
const doc = (slug: string, registrationContainer?: string) => ({
  slug,
  category: "mail",
  forClass: "http://schema.org/EmailMessage",
  dataset: new Store(),
  registrationContainer,
});

function writer(fetch: typeof globalThis.fetch) {
  return createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch,
  });
}

function adapter(run: (ctx: ImportContext) => Promise<void>): IntegrationAdapter {
  return {
    metadata: {
      id: "toy",
      name: "Toy",
      tier: "A",
      authKind: "oauth-pkce",
      scopes: [],
      categories: ["mail"],
      whatYouGet: "",
      requirements: [],
    },
    fixtures: () => [{ url: "https://source.test/", json: {} }],
    async import(ctx) {
      await run(ctx);
      return {};
    },
  };
}

describe("resource removal", () => {
  it("deletes under the ETag of a preceding read and drops the document from the report", async () => {
    const pod = createMemoryPod();
    const fetch = vi.fn(pod.fetch);
    const report = await runImport({
      adapter: adapter(async (ctx) => {
        await ctx.write(doc("a/one.ttl"));
        await ctx.write(doc("a/two.ttl"));
        await ctx.read("a/one.ttl");
        await ctx.remove("a/one.ttl");
        await ctx.remove("a/missing.ttl");
      }),
      podWriter: writer(fetch),
      mode: "demo",
    });
    expect(pod.get(`${ROOT}a/one.ttl`)).toBeUndefined();
    expect(report.written.map((w) => w.url)).toEqual([`${ROOT}a/two.ttl`]);
    const deletes = fetch.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(new Headers(deletes[0]?.[1]?.headers).get("if-match")).toBe('"v1"');
    expect(new Headers(deletes[1]?.[1]?.headers).has("if-match")).toBe(false);
  });

  it("surfaces failed deletes and refuses escaping or reserved slugs", async () => {
    const forbidden = async (_: RequestInfo | URL, init?: RequestInit) =>
      new Response(null, { status: init?.method === "DELETE" ? 403 : 404 });
    await expect(writer(forbidden).remove?.("a/x.ttl")).rejects.toBeInstanceOf(ResourceWriteError);
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(writer(fetch).remove?.("../x.ttl")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const pod = createMemoryPod();
    await expect(
      runImport({
        adapter: adapter((ctx) => ctx.remove("_provenance.ttl")),
        podWriter: writer(pod.fetch),
        mode: "demo",
      }),
    ).rejects.toThrow("Reserved connector provenance slug.");
  });

  it("fails clearly when the host writer cannot delete", async () => {
    const pod = createMemoryPod();
    const { remove: _omitted, ...rest } = writer(pod.fetch);
    const port: PodWriter = rest;
    await expect(
      runImport({ adapter: adapter((ctx) => ctx.remove("a.ttl")), podWriter: port, mode: "demo" }),
    ).rejects.toThrow("This host cannot delete resources.");
  });
});

describe("registration container", () => {
  it("registers the ancestor container instead of the document's own", async () => {
    const pod = createMemoryPod();
    const report = await runImport({
      adapter: adapter(async (ctx) => {
        await ctx.write(doc("mail/acct/messages/1.ttl", "mail/acct/"));
      }),
      podWriter: writer(pod.fetch),
      mode: "demo",
    });
    expect(report.written[0]?.registrationContainer).toBe(`${ROOT}mail/acct/`);
    const index = pod.get(report.indexUrl) ?? "";
    expect(index).toContain(`${ROOT}mail/acct/`);
    expect(index).not.toContain(`${ROOT}mail/acct/messages/`);
  });

  it.each([
    "mail/other/",
    "mail/acct",
  ])("refuses %s, which does not contain the document", async (container) => {
    const pod = createMemoryPod();
    await expect(
      runImport({
        adapter: adapter(async (ctx) => {
          await ctx.write(doc("mail/acct/messages/1.ttl", container));
        }),
        podWriter: writer(pod.fetch),
        mode: "demo",
      }),
    ).rejects.toThrow("Registration container must contain the document.");
  });
});

describe("single-flight runs", () => {
  it("refuses a second run of the same connector while one is in progress", async () => {
    const pod = createMemoryPod();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runImport({
      adapter: adapter(async (ctx) => {
        await ctx.write(doc("a/one.ttl"));
        await gate;
      }),
      podWriter: writer(pod.fetch),
      mode: "demo",
    });
    await vi.waitFor(() => expect(pod.get(`${ROOT}a/one.ttl`)).toBeDefined());
    await expect(
      runImport({ adapter: adapter(async () => {}), podWriter: writer(pod.fetch), mode: "demo" }),
    ).rejects.toThrow("already running");
    release();
    await first;
    // The claim is released after success and after failure.
    await runImport({
      adapter: adapter(async () => {
        throw new Error("boom");
      }),
      podWriter: writer(pod.fetch),
      mode: "demo",
    }).catch(() => undefined);
    await runImport({
      adapter: adapter(async (ctx) => void (await ctx.write(doc("a/two.ttl")))),
      podWriter: writer(pod.fetch),
      mode: "demo",
    });
    expect(pod.get(`${ROOT}a/two.ttl`)).toBeDefined();
  });
});
