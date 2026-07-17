// AUTHORED-BY Claude Fable 5
/**
 * The shipped JSON-Schema artifact is GENERATED from the zod schema — this suite pins
 * that it can never drift from the runtime validator (regenerate with
 * `pnpm run build && pnpm run generate:schema`), and that the editorial floors are
 * carried in the artifact itself.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { walkthroughJsonSchema } from "../src/index.js";

const artifactPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../schema/walkthrough.v1.json",
);

function readArtifact(): Record<string, unknown> {
  return JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
}

test("schema/walkthrough.v1.json is byte-in-sync with the zod schema", () => {
  expect(readArtifact()).toEqual(walkthroughJsonSchema());
  // Byte-level too (stable serialization): the artifact is the pretty-printed output.
  expect(readFileSync(artifactPath, "utf8")).toBe(
    `${JSON.stringify(walkthroughJsonSchema(), null, 2)}\n`,
  );
});

test("the artifact identifies itself and requires the document core", () => {
  const artifact = readArtifact();
  expect(artifact.$id).toBe("walkthrough.v1.json");
  expect(artifact.$schema).toContain("2020-12");
  expect(artifact.required).toEqual(
    expect.arrayContaining([
      "version",
      "site",
      "branding",
      "persona",
      "registry",
      "chapters",
      "deploy",
    ]),
  );
});

test("editorial minima carry the absolute floors (minimum 2 / minimum 20)", () => {
  const artifact = readArtifact();
  const properties = artifact.properties as Record<
    string,
    { properties?: Record<string, Record<string, unknown>> }
  >;
  const editorial = properties.editorial?.properties;
  expect(editorial?.minSteps?.minimum).toBe(2);
  expect(editorial?.minUnderneathChars?.minimum).toBe(20);

  // The chapter shape pins the same floors structurally.
  const chapters = properties.chapters as unknown as {
    items: { properties: Record<string, Record<string, unknown>> };
  };
  expect(chapters.items.properties.steps?.minItems).toBe(2);
  const underneath = chapters.items.properties.underneath as { items?: { minLength?: number } };
  expect(underneath.items?.minLength).toBe(20);
});

test("branding is composed from the kit's schema (kit owns the contract)", () => {
  const artifact = readArtifact();
  const properties = artifact.properties as Record<string, Record<string, unknown>>;
  const branding = properties.branding as { required?: string[] };
  expect(branding.required).toEqual(
    expect.arrayContaining(["convener", "domainNegations", "description"]),
  );
});
