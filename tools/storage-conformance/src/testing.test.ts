// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { StorageError } from "@jeswr/storage-client";
import { expect, test } from "vitest";
import { assertIsomorphic, expectStorageError } from "./testing.js";

test("structured error assertions reject wrong errors, codes, statuses and success", async () => {
  const error = new StorageError("not-found", {
    method: "GET",
    url: "https://example.org/",
    status: 404,
  });
  expect(await expectStorageError(Promise.reject(error), "not-found")).toBe(error);
  expect(await expectStorageError(Promise.reject(error), "not-found", 404)).toBe(error);
  await expect(expectStorageError(Promise.resolve(), "not-found")).rejects.toThrow(
    "Expected the operation to fail",
  );
  await expect(expectStorageError(Promise.reject(new Error()), "not-found")).rejects.toThrow(
    "Expected StorageError",
  );
  await expect(expectStorageError(Promise.reject(error), "conflict")).rejects.toThrow();
  await expect(expectStorageError(Promise.reject(error), "not-found", 403)).rejects.toThrow();
});

test("RDF isomorphism preserves literal types/language, predicates and blank-node sharing", async () => {
  const parse = (text: string) => parseRdf(text, "text/turtle");
  const a = await parse('_:a <urn:p> _:b . _:b <urn:p> "hello"@en .');
  const b = await parse('_:z <urn:p> "hello"@en . _:y <urn:p> _:z .');
  expect(() => assertIsomorphic(a, b)).not.toThrow();
  const cases = [
    '_:x <urn:p> _:y . _:y <urn:p> "hello"@fr .',
    '_:x <urn:p> _:y . _:y <urn:q> "hello"@en .',
    '_:x <urn:p> _:x . _:y <urn:p> "hello"@en .',
    '<urn:x> <urn:p> <urn:y> . <urn:y> <urn:p> "hello"@en .',
    "_:x <urn:p> _:y .",
  ];
  for (const text of cases) {
    const changed = await parse(text);
    expect(() => assertIsomorphic(a, changed)).toThrow();
  }
  const named = await parse('<urn:s> <urn:p> "7"^^<http://www.w3.org/2001/XMLSchema#integer>.');
  expect(() => assertIsomorphic(named, named)).not.toThrow();
  const string = await parse('<urn:s> <urn:p> "7".');
  expect(() => assertIsomorphic(named, string)).toThrow();
  const empty = await parse("");
  expect(() => assertIsomorphic(empty, empty)).not.toThrow();
});
