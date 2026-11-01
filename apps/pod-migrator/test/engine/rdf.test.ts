// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { serialize as serializeAccess } from "../../../../packages/pod-access/src/rdf.js";
import { safeIri, serialize } from "../../src/engine/rdf.js";

it("serializes caller-owned RDF with the same validation and bytes as access documents", async () => {
  const dataset = await parseRdf(
    '<urn:subject> <urn:predicate> [ <urn:value> "literal" ].',
    "text/turtle",
  );
  const turtle = await serialize(dataset);
  expect(turtle).toBe(await serializeAccess(dataset));
  expect((await parseRdf(turtle, "text/turtle")).size).toBe(2);
  expect(safeIri("urn:valid")).toBe("urn:valid");
  expect(() => safeIri("relative")).toThrow("Unsafe RDF IRI");
  expect(() => safeIri("https://pod.example/> <urn:forged> <urn:p> <urn:o>")).toThrow(
    "Unsafe RDF IRI",
  );
});

it("propagates RDF writer failures", async () => {
  const spy = vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback: unknown) => {
    (callback as (error: Error) => void)(new Error("writer failure"));
    return undefined as never;
  });
  try {
    await expect(serialize(new Store())).rejects.toThrow("writer failure");
  } finally {
    spy.mockRestore();
  }
});
