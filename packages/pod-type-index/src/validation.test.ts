// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scoped } from "./common.js";
import { createTypeIndex } from "./index.js";
import { emptyDocument, serialize } from "./rdf.js";

const ROOT = "https://pod.example/alice/";
const PROFILE = `${ROOT}profile/card#me`;
function setup() {
  const storage = createMemoryStorage({ root: ROOT });
  return {
    storage,
    index: createTypeIndex({ storage, features: storage.features, profile: PROFILE }),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("Type Index input contracts", () => {
  it.each([
    "",
    "relative",
    "https://example.org/has space",
    "urn:bad\0",
    'urn:bad"',
    "urn:bad\\",
  ])("rejects invalid class IRIs (%s)", async (iri) => {
    const { index } = setup();
    await expect(index.find(iri)).rejects.toThrow(TypeError);
    await expect(index.register(iri, { instance: `${ROOT}one` })).rejects.toThrow(TypeError);
  });

  it("rejects mismatched feature protocols", () => {
    const { storage } = setup();
    expect(() =>
      createTypeIndex({
        storage,
        features: { ...storage.features, protocol: "lws" },
        profile: PROFILE,
      }),
    ).toThrow(TypeError);
  });

  it.each([
    {},
    { instance: `${ROOT}one`, container: `${ROOT}many/` },
  ])("requires one location (%j)", async (location) => {
    const { index } = setup();
    await expect(index.register("urn:Class", location)).rejects.toThrow(TypeError);
    await expect(index.unregister("urn:Class", location)).rejects.toThrow(TypeError);
  });

  it("rejects invalid visibility", async () => {
    const { index } = setup();
    await expect(
      index.register("urn:Class", { instance: `${ROOT}one` }, { index: "other" as never }),
    ).rejects.toThrow(TypeError);
  });

  it.each([
    `${ROOT}noslash`,
    `${ROOT}many/?q=1/`,
    `${ROOT}many/#fragment/`,
  ])("requires a Solid container URL (%s)", async (container) => {
    const { index } = setup();
    await expect(index.register("urn:Class", { container })).rejects.toThrow(TypeError);
  });

  it.each([
    "not a url",
    "javascript:alert(1)",
    "https:/pod.example/alice/one",
    "https:\\pod.example/alice/one",
    "https://pod.example/alice/a b",
    "https://pod.example/alice/a\0",
    "https://user@pod.example/alice/one",
    "https://:password@pod.example/alice/one",
    "https://foreign.example/",
    "https://pod.example/alice2/one",
  ])("rejects unsafe profile and location URLs without disclosing them (%s)", async (url) => {
    const { storage, index } = setup();
    expect(scoped(storage, url)).toBeUndefined();
    await expect(index.register("urn:Class", { instance: url })).rejects.toMatchObject({
      code: "scope",
      url: ROOT,
    });
    expect(() => createTypeIndex({ storage, features: storage.features, profile: url })).toThrow(
      StorageError,
    );
  });

  it("survives a rejecting scope implementation", () => {
    const { storage } = setup();
    vi.spyOn(storage, "isWithinStorage").mockImplementationOnce(() => {
      throw new Error("refused");
    });
    expect(scoped(storage, `${ROOT}one`)).toBeUndefined();
  });

  it("propagates N3 serialization errors", async () => {
    vi.spyOn(Writer.prototype, "end").mockImplementationOnce(function (callback) {
      callback(new Error("N3 failure"), "");
      return this;
    });
    await expect(serialize(emptyDocument(`${ROOT}index`))).rejects.toThrow("N3 failure");
  });
});
