// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import { abortableFetch, abortablePodWriter, unlessAborted } from "./abort.js";
import type { PodWriter } from "./types.js";

const reason = new Error("cancelled by user");

describe("abortableFetch", () => {
  function recording() {
    const sent: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      sent.push({ input, init });
      return new Response(null, { status: 204 });
    });
    return { sent, transport };
  }

  it("refuses to send once aborted, with the abort reason", async () => {
    const controller = new AbortController();
    const { transport } = recording();
    const guarded = abortableFetch(transport, controller.signal);
    controller.abort(reason);
    for (const method of ["GET", "PUT", "PATCH", "POST", "DELETE"])
      await expect(guarded("https://pod.test/a", { method })).rejects.toBe(reason);
    expect(transport).not.toHaveBeenCalled();
  });

  it("passes the run signal to a request with no signal of its own", async () => {
    const controller = new AbortController();
    const { sent, transport } = recording();
    await abortableFetch(transport, controller.signal)("https://pod.test/a");
    const signal = sent[0]?.init?.signal as AbortSignal;
    expect(signal).toBe(controller.signal);
  });

  it("composes the run signal with init.signal, aborting an in-flight request", async () => {
    const run = new AbortController();
    const own = new AbortController();
    const { sent, transport } = recording();
    await abortableFetch(transport, run.signal)("https://pod.test/a", {
      method: "PUT",
      body: "x",
      signal: own.signal,
    });
    const signal = sent[0]?.init?.signal as AbortSignal;
    expect(sent[0]?.init?.method).toBe("PUT");
    expect(sent[0]?.init?.body).toBe("x");
    expect(signal.aborted).toBe(false);
    run.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it("keeps a caller's own init.signal effective", async () => {
    const own = new AbortController();
    const { sent, transport } = recording();
    await abortableFetch(transport, new AbortController().signal)("https://pod.test/a", {
      signal: own.signal,
    });
    own.abort(reason);
    expect(sent[0]?.init?.signal?.aborted).toBe(true);
  });

  it("composes with a Request's signal when init has none", async () => {
    const own = new AbortController();
    const { sent, transport } = recording();
    await abortableFetch(
      transport,
      new AbortController().signal,
    )(new Request("https://pod.test/a", { method: "DELETE", signal: own.signal }));
    expect(sent[0]?.input).toBeInstanceOf(Request);
    expect(sent[0]?.input).toMatchObject({ method: "DELETE" });
    own.abort(reason);
    expect(sent[0]?.init?.signal?.aborted).toBe(true);
  });

  it("lets init.signal: null override a Request's signal, as Fetch does", async () => {
    const run = new AbortController();
    const { sent, transport } = recording();
    await abortableFetch(transport, run.signal)(
      new Request("https://pod.test/a", { signal: AbortSignal.abort(reason) }),
      { signal: null },
    );
    expect(sent[0]?.init?.signal).toBe(run.signal);
  });
});

describe("abortablePodWriter", () => {
  function writer(withOptional: boolean) {
    const calls: string[] = [];
    const base: PodWriter = {
      webId: "https://pod.test/profile#me",
      resolve: (slug) => `https://pod.test/${slug}`,
      read: async (slug) => {
        calls.push(`read ${slug}`);
        return undefined;
      },
      write: async (doc, conditions) => {
        calls.push(`write ${doc.slug} ${JSON.stringify(conditions)}`);
        return { url: `https://pod.test/${doc.slug}`, category: doc.category, forClass: "x" };
      },
      registerType: async (registrations) => {
        calls.push(`register ${registrations.length}`);
        return { indexUrl: "https://pod.test/index" };
      },
      ...(withOptional && {
        writeBinary: async (doc) => {
          calls.push(`binary ${doc.slug}`);
          return { url: `https://pod.test/${doc.slug}`, created: true };
        },
        remove: async (slug, conditions) => {
          calls.push(`remove ${slug} ${conditions?.ifMatch}`);
        },
      }),
    };
    return { base, calls };
  }
  const doc = { slug: "a.ttl", category: "c", forClass: "x", dataset: [] as never };

  it("delegates every port while the signal is live, preserving arguments", async () => {
    const { base, calls } = writer(true);
    const guarded = abortablePodWriter(base, new AbortController().signal);
    expect(guarded.webId).toBe(base.webId);
    expect(guarded.resolve("a.ttl")).toBe("https://pod.test/a.ttl");
    await guarded.read("a.ttl");
    await guarded.write(doc, { ifMatch: '"1"' });
    await guarded.writeBinary?.({ slug: "b.bin", body: new Uint8Array(), contentType: "x/y" });
    await guarded.remove?.("c.ttl", { ifMatch: '"2"' });
    await guarded.registerType([{ forClass: "x", container: "https://pod.test/" }]);
    expect(calls).toEqual([
      "read a.ttl",
      'write a.ttl {"ifMatch":"\\"1\\""}',
      "binary b.bin",
      'remove c.ttl "2"',
      "register 1",
    ]);
  });

  it("refuses every port once aborted, before the underlying writer is called", async () => {
    const controller = new AbortController();
    const { base, calls } = writer(true);
    const guarded = abortablePodWriter(base, controller.signal);
    controller.abort(reason);
    await expect(guarded.read("a.ttl")).rejects.toBe(reason);
    await expect(guarded.write(doc)).rejects.toBe(reason);
    await expect(
      guarded.writeBinary?.({ slug: "b.bin", body: new Uint8Array(), contentType: "x/y" }),
    ).rejects.toBe(reason);
    await expect(guarded.remove?.("c.ttl")).rejects.toBe(reason);
    await expect(guarded.registerType([])).rejects.toBe(reason);
    expect(calls).toEqual([]);
  });

  it("keeps optional ports absent and passes through without a signal", async () => {
    const { base, calls } = writer(false);
    const guarded = abortablePodWriter(base, undefined);
    expect(guarded.writeBinary).toBeUndefined();
    expect(guarded.remove).toBeUndefined();
    await guarded.write(doc);
    expect(calls).toEqual(["write a.ttl undefined"]);
  });

  it("unlessAborted rejects rather than throwing synchronously", () => {
    const step = vi.fn(async () => 1);
    const guarded = unlessAborted(AbortSignal.abort(reason), step);
    const pending = guarded();
    expect(pending).toBeInstanceOf(Promise);
    expect(step).not.toHaveBeenCalled();
    return expect(pending).rejects.toBe(reason);
  });
});
