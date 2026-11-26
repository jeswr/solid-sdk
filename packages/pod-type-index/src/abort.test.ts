// AUTHORED-BY Claude Sonnet 5.5
// AUTHORED-BY Claude Opus 5.5
import type { Features } from "@jeswr/storage-capabilities";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";
import { createTypeIndex } from "./index.js";

const CLASS = `${NS.POD_DOCS}Document`;

async function expectAborted(promise: Promise<unknown>, reason: unknown) {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(StorageError);
  expect((error as StorageError).code).toBe("network");
  expect((error as StorageError).retryable).toBe(false);
  expect((error as StorageError).cause).toBe(reason);
}

describe("Solid Type Index cancellation", () => {
  const Root = "https://pod.example/alice/";
  const Webid = `${Root}profile/card#me`;

  async function setup() {
    const storage = createMemoryStorage({ root: Root });
    await storage.write(`${Root}profile/card`, `<${Webid}> <${NS.FOAF}name> "Alice".`, {
      contentType: "text/turtle",
      ifMatch: "*",
    });
    return {
      storage,
      index: createTypeIndex({ storage, features: storage.features, profile: Webid }),
    };
  }

  it("findAll rejects without I/O when already aborted", async () => {
    const { storage, index } = await setup();
    const readRdf = vi.spyOn(storage, "readRdf");
    const reason = new Error("stop");
    await expectAborted(index.findAll([CLASS], { signal: AbortSignal.abort(reason) }), reason);
    await expectAborted(index.find(CLASS, { signal: AbortSignal.abort(reason) }), reason);
    expect(readRdf).not.toHaveBeenCalled();
  });

  it("findAll passes the caller's signal to reads and rejects when aborted mid-flight", async () => {
    const { storage, index } = await setup();
    const controller = new AbortController();
    const reason = new Error("mid-flight");
    const seen: (AbortSignal | undefined)[] = [];
    vi.spyOn(storage, "readRdf").mockImplementation(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          const signal = opts?.signal;
          seen.push(signal);
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const pending = index.findAll([CLASS], { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    controller.abort(reason);
    // The read rejects with the raw reason; findAll must not swallow it as an index miss.
    await expect(pending).rejects.toBe(reason);
  });

  it("register and unregister reject before touching storage and stop retrying", async () => {
    const { storage, index } = await setup();
    const readRdf = vi.spyOn(storage, "readRdf");
    const reason = new Error("stop");
    const signal = AbortSignal.abort(reason);
    await expectAborted(index.register(CLASS, { container: `${Root}docs/` }, { signal }), reason);
    await expectAborted(index.unregister(CLASS, { container: `${Root}docs/` }, { signal }), reason);
    expect(readRdf).not.toHaveBeenCalled();
  });

  it("register does not retry a conflict once the caller has aborted", async () => {
    const { storage, index } = await setup();
    const controller = new AbortController();
    const reason = new Error("stop");
    const read = vi.spyOn(storage, "readRdf").mockImplementation(async () => {
      controller.abort(reason);
      throw new StorageError("conflict", { url: Root, method: "GET" });
    });
    // The abort is reported, not the conflict that would otherwise have been retried.
    await expectAborted(
      index.register(CLASS, { container: `${Root}docs/` }, { signal: controller.signal }),
      reason,
    );
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("LWS Type Index cancellation", () => {
  const Root = "https://lws.example/alice/";
  const Search = `${Root}search`;

  function setup() {
    const storage = createMemoryStorage({ protocol: "lws", root: Root });
    const features: Features = {
      ...storage.features,
      typeIndex: {
        state: "available",
        evidence: "fixture",
        detail: { mode: "server", searchEndpoint: Search, indexEndpoint: `${Root}types` },
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    return {
      fetch,
      index: createTypeIndex({ storage, features, profile: "https://id.example/#me", fetch }),
    };
  }

  it("findAll and listClasses reject without a request when already aborted", async () => {
    const { index, fetch } = setup();
    const reason = new Error("stop");
    await expectAborted(index.findAll([CLASS], { signal: AbortSignal.abort(reason) }), reason);
    await expectAborted(index.listClasses({ signal: AbortSignal.abort(reason) }), reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("findAll aborts the in-flight QUERY with the caller's signal", async () => {
    const { index, fetch } = setup();
    const controller = new AbortController();
    const reason = new Error("mid-flight");
    const pending = index.findAll([CLASS], { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(reason);
    await expectAborted(pending, reason);
  });
});
