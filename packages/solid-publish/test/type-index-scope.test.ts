// AUTHORED-BY Claude Sonnet 5.5
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { publishRepository } from "../src/index.js";
import { owner, podFixture } from "./fixtures.js";

const factory = vi.hoisted(() => ({ failure: undefined as unknown }));
vi.mock("@jeswr/pod-type-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/pod-type-index")>();
  return {
    ...actual,
    createTypeIndex: (...args: Parameters<typeof actual.createTypeIndex>) => {
      if (factory.failure) throw factory.failure;
      return actual.createTypeIndex(...args);
    },
  };
});

describe("Type Index construction failures", () => {
  it("only a `scope` StorageError is tolerated; everything else surfaces", async () => {
    const pod = await podFixture();
    factory.failure = new StorageError("scope", { method: "GET", url: owner });
    expect(() => publishRepository(pod.storage, pod.fetch, owner)).not.toThrow();
    factory.failure = new StorageError("forbidden", { method: "GET", url: owner });
    expect(() => publishRepository(pod.storage, pod.fetch, owner)).toThrow(StorageError);
    factory.failure = new TypeError("broken");
    expect(() => publishRepository(pod.storage, pod.fetch, owner)).toThrow("broken");
    factory.failure = undefined;
  });
});
