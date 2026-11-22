// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProfile, loadScenario, readCaseGraph } from "../src/engine/load.js";
import { VC_CONTEXT } from "../src/wire/contexts.js";
import { readDocument } from "../src/wire/document.js";

const context = "https://w3id.org/jeswr/awp/context/scenario/v1";
const cases = [
  ["agent-profile", "profiles/mortgage.json", loadProfile],
  ["agent-scenario", "scenarios/mortgage-core.json", loadScenario],
] as const;
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "awp-case-envelope-"));
});
afterEach(() => rmSync(directory, { force: true, recursive: true }));

function fixture(file: string) {
  const {
    "@context": _,
    schema: __,
    ...body
  } = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  return body;
}

function write(document: unknown) {
  const path = join(directory, "fixture.json");
  writeFileSync(path, JSON.stringify(document));
  return path;
}

describe.each(cases)("%s envelope", (kind, file, load) => {
  it("loads the pinned envelope as the same engine object as legacy JSON", () => {
    const body = fixture(file);
    const legacy = load(write({ schema: `${kind}/0.1`, ...body }));
    const current = load(write({ "@context": context, schema: `${kind}/0.2`, ...body }));
    expect(current).toEqual(legacy);
    expect(current.schema).toBe(`${kind}/0.1`);
    expect(current).not.toHaveProperty("@context");
  });

  it.each([
    ["missing context", "0.2", {}],
    ["different context", "0.2", { "@context": VC_CONTEXT }],
    ["array context", "0.2", { "@context": [context] }],
    ["inline context", "0.2", { "@context": { id: "@id" } }],
    ["null context", "0.2", { "@context": null }],
    ["legacy with context", "0.1", { "@context": context }],
    ["unsupported version", "0.3", { "@context": context }],
  ])("names the file when refusing %s", (_description, version, envelope) => {
    const path = write({ ...envelope, schema: `${kind}/${version}`, ...fixture(file) });
    expect(() => load(path)).toThrow(path);
  });
});

it.each(["root", "nested", "indexed value"])("refuses an undefined term in the %s", async (at) => {
  const body = fixture("scenarios/mortgage-core.json");
  if (at === "root") body.undefinedKey = true;
  else if (at === "nested") body.script[0].undefinedKey = true;
  else body.trust.ownLists = { fictitious: [{ party: "urn:test:party", undefinedKey: true }] };
  const path = write({ "@context": context, schema: "agent-scenario/0.2", ...body });
  await expect(readCaseGraph(path)).rejects.toThrow("undefined-term");
});

it("refuses a foreign context at a nested fixture node", async () => {
  const body = fixture("scenarios/mortgage-core.json");
  body.script[0]["@context"] = "https://example.invalid/context";
  await expect(
    readCaseGraph(write({ "@context": context, schema: "agent-scenario/0.2", ...body })),
  ).rejects.toThrow("context-not-accepted");
});

it("keeps the fixture JSON-literal option out of readDocument", async () => {
  const body = fixture("scenarios/mortgage-core.json");
  body.statements[0].value = { arbitraryKey: [null, { "@context": "https://example.invalid/" }] };
  const document = { "@context": context, schema: "agent-scenario/0.2", ...body };
  await expect(readCaseGraph(write(document))).resolves.toHaveProperty("root");

  const options = { suite: "jws" as const, allowJson: true };
  await expect(
    readDocument(JSON.stringify(document), "application/ld+json", options),
  ).resolves.toMatchObject({ ok: false, detail: "context-not-accepted" });

  const credential = {
    "@context": VC_CONTEXT,
    id: "urn:test:credential",
    type: "JsonSchema",
    jsonSchema: { arbitraryKey: true },
  };
  await expect(
    readDocument(JSON.stringify(credential), "application/ld+json", options),
  ).resolves.toMatchObject({ ok: false, detail: "undefined-term" });
  await expect(
    readDocument(
      JSON.stringify({
        ...credential,
        jsonSchema: { "@type": "@json", "@value": { arbitraryKey: true } },
      }),
      "application/ld+json",
      options,
    ),
  ).resolves.toMatchObject({ ok: false, detail: "undefined-term" });
});
