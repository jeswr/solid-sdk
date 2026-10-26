// AUTHORED-BY GPT-6.1-Sol
import { expect, test } from "vitest";
import * as cache from "./cache.js";
import * as api from "./index.js";
import * as testing from "./testing.js";

test("public parser, errors, fixture and cache entry points load", () => {
  expect(Object.keys(api).sort()).toEqual([
    "CapabilitiesError",
    "capabilities",
    "deriveFeatures",
    "parseLwsDescription",
    "probe",
    "resolveStorageDescription",
  ]);
  expect(Object.keys(cache).sort()).toEqual(["createIndexedDbCache", "createMemoryCache"]);
  expect(Object.keys(testing).sort()).toEqual([
    "cssStorage",
    "essStorage",
    "fixtureFetch",
    "nssStorage",
    "sparqLwsCid",
    "sparqLwsStorage",
    "storageFixtures",
  ]);
  expect(testing.sparqLwsCid.type).toEqual(["Storage"]);
});

test("CapabilitiesError carries the discovery code, URL, message and optional HTTP status", () => {
  const error = new api.CapabilitiesError("description-invalid", "https://pod.example/cid");
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: "CapabilitiesError",
    message: "description-invalid",
    code: "description-invalid",
    url: "https://pod.example/cid",
    status: undefined,
  });
  expect(
    new api.CapabilitiesError("description-unreachable", error.url, "Missing CID", 404),
  ).toMatchObject({ message: "Missing CID", status: 404 });
});
