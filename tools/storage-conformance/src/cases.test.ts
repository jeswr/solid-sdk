// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "@jeswr/storage-client";
import { expect, test, vi } from "vitest";
import { storageCases } from "./cases.js";
import { memoryTarget } from "./targets/memory.js";

const notRdf = storageCases.find((scenario) => scenario.id === "SC-RDF-not-rdf");
if (!notRdf) throw new Error("Missing SC-RDF-not-rdf scenario");

test.each([
  "solid",
  "lws",
] as const)("%s opaque storage must reject both non-RDF and malformed RDF reads", async (protocol) => {
  const target = await memoryTarget(protocol).start();
  try {
    const read = vi.spyOn(target.storage, "readRdf");
    await notRdf.run(target);
    expect(read).toHaveBeenCalledTimes(2);
    for (const result of read.mock.results)
      await expect(result.value).rejects.toMatchObject({ code: "not-rdf" });
  } finally {
    await target.stop();
  }
});

test.each([
  400, 422,
])("accepts create-time RDF validation (%i) after asserting the plain-text read error", async (status) => {
  const target = await memoryTarget("solid").start();
  try {
    const create = target.storage.create.bind(target.storage);
    vi.spyOn(target.storage, "create").mockImplementation((parent, body, options) => {
      if (options?.name === "bad.ttl") {
        expect(body).toBe("< invalid turtle");
        expect(options.contentType).toBe("text/turtle");
        throw new StorageError("bad-request", { method: "PUT", url: parent, status });
      }
      return create(parent, body, options);
    });
    const read = vi.spyOn(target.storage, "readRdf");
    await notRdf.run(target);
    expect(read).toHaveBeenCalledOnce();
    await expect(read.mock.results[0]?.value).rejects.toMatchObject({ code: "not-rdf" });
  } finally {
    await target.stop();
  }
});

test.each([
  new Error("transport failed"),
  new StorageError("network", { method: "PUT", url: "https://memory-solid.example/" }),
  new StorageError("forbidden", {
    method: "PUT",
    url: "https://memory-solid.example/",
    status: 403,
  }),
  new StorageError("server", {
    method: "PUT",
    url: "https://memory-solid.example/",
    status: 500,
  }),
  new StorageError("bad-request", { method: "PUT", url: "https://memory-solid.example/" }),
  new StorageError("bad-request", {
    method: "PUT",
    url: "https://memory-solid.example/",
    status: 409,
  }),
])("does not accept an unrelated malformed-RDF create failure (%s)", async (error) => {
  const target = await memoryTarget("solid").start();
  try {
    const create = target.storage.create.bind(target.storage);
    vi.spyOn(target.storage, "create").mockImplementation((parent, body, options) => {
      if (options?.name === "bad.ttl") throw error;
      return create(parent, body, options);
    });
    await expect(notRdf.run(target)).rejects.toThrow();
  } finally {
    await target.stop();
  }
});

test.each([1, 2])("still requires not-rdf on read %i", async (readNumber) => {
  const target = await memoryTarget("solid").start();
  try {
    const readRdf = target.storage.readRdf.bind(target.storage);
    let calls = 0;
    vi.spyOn(target.storage, "readRdf").mockImplementation((url, options) => {
      if (++calls === readNumber) {
        throw new StorageError("bad-request", { method: "GET", url, status: 400 });
      }
      return readRdf(url, options);
    });
    await expect(notRdf.run(target)).rejects.toThrow();
  } finally {
    await target.stop();
  }
});
