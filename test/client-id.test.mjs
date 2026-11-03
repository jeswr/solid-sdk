// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { clientIdPath, createClientIdDocument, writeClientId } from "../scripts/client-id.mjs";
import { runCommand } from "./helpers/run-command.mjs";

// Reuse declared workspace test dependencies without adding root/runtime dependencies.
const { z } = createRequire(new URL("../packages/suite-ui/package.json", import.meta.url))("zod");
const jsonld = createRequire(
  new URL("../packages/solid-federation-vocab/package.json", import.meta.url),
)("jsonld");
const entry = fileURLToPath(new URL("../scripts/client-id.mjs", import.meta.url));
const oidcContext = "https://www.w3.org/ns/solid/oidc-context.jsonld";
const fed = "https://jeswr.org/ns/fed#";
const oidc = "http://www.w3.org/ns/solid/oidc#";
const directories = [];
const config = {
  origin: "https://suite.example",
  name: "Solid Suite",
  logo: "https://assets.example/logo.svg",
  redirectUris: [
    "https://suite.example/auth/callback.html",
    "https://suite.example/drive/callback?mode=popup",
  ],
  fedapp: {
    sectors: [
      "https://jeswr.org/ns/sectors/scheduling#sector",
      "https://jeswr.org/ns/sectors/documents#sector",
    ],
    access: ["http://www.w3.org/ns/auth/acl#Read", "http://www.w3.org/ns/auth/acl#Write"],
    consumes: ["http://www.w3.org/2005/01/wf/flow#Task"],
    produces: ["https://suite.example/model#Note"],
    declaresShape: ["https://suite.example/shapes#NoteShape"],
  },
};

// Solid-OIDC §5.1 / RFC 7591 §2 registration schema, narrowed to ADR-004 D7.
// The spec defines metadata rather than publishing a normative JSON Schema.
const uriList = z.array(z.url()).min(1);
const clientIdSchema = z.object({
  "@context": z.tuple([z.literal(oidcContext), z.record(z.string(), z.unknown())]),
  client_id: z.url(),
  client_name: z.string().min(1),
  client_uri: z.url(),
  logo_uri: z.url().optional(),
  redirect_uris: uriList,
  scope: z.literal("openid webid offline_access"),
  grant_types: z.tuple([z.literal("authorization_code"), z.literal("refresh_token")]),
  response_types: z.tuple([z.literal("code")]),
  token_endpoint_auth_method: z.literal("none"),
  dpop_bound_access_tokens: z.literal(true),
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(input = JSON.stringify(config)) {
  const root = mkdtempSync(join(tmpdir(), "client-id-"));
  directories.push(root);
  const path = join(root, "config.json");
  writeFileSync(path, input);
  return { root, path, output: join(root, "public"), document: join(root, "public", clientIdPath) };
}

function cli(args, cwd = tmpdir()) {
  return runCommand(process.execPath, [entry, ...args], { cwd, encoding: "utf8" });
}

describe("Client Identifier Document", () => {
  it("validates against the Solid-OIDC registration schema and the D7 public-client profile", () => {
    const document = createClientIdDocument(config);
    expect(clientIdSchema.safeParse(document).success).toBe(true);
    expect(document.client_id).toBe("https://suite.example/.well-known/solid-client-id.jsonld");
    expect(document.client_uri).toBe("https://suite.example/");
    expect(document.client_name).toBe(config.name);
    expect(document.logo_uri).toBe(config.logo);
    expect(document.redirect_uris).toEqual(config.redirectUris);
    expect(document["@type"]).toBe("fedapp:App");
    expect(
      clientIdSchema.safeParse({ ...document, redirect_uris: config.redirectUris[0] }).success,
    ).toBe(false);
    expect(clientIdSchema.safeParse({ ...document, dpop_bound_access_tokens: false }).success).toBe(
      false,
    );
    expect(
      clientIdSchema.safeParse({ ...document, token_endpoint_auth_method: "client_secret_basic" })
        .success,
    ).toBe(false);
  });

  it("expands federation links and DPoP metadata on the client subject without network contexts", async () => {
    const document = createClientIdDocument(config);
    const loaded = [];
    const expanded = await jsonld.expand(document, {
      documentLoader: async (url) => {
        loaded.push(url);
        expect(url).toBe(oidcContext);
        // Offline copy of https://solidproject.org/TR/oidc, Appendix A.
        return {
          contextUrl: null,
          documentUrl: url,
          document: JSON.parse(
            readFileSync(new URL("./fixtures/solid-oidc-context.jsonld", import.meta.url), "utf8"),
          ),
        };
      },
    });
    expect(loaded).toEqual([oidcContext]);
    expect(expanded).toHaveLength(1);
    const [subject] = expanded;
    expect(subject["@id"]).toBe(document.client_id);
    expect(subject["@type"]).toEqual([`${fed}App`]);
    for (const [term, values] of Object.entries(config.fedapp)) {
      expect(subject[`${fed}${term === "sectors" ? "sector" : term}`]).toEqual(
        values.map((value) => ({ "@id": value })),
      );
    }
    expect(subject[`${oidc}redirect_uris`]).toEqual(
      config.redirectUris.map((uri) => ({ "@id": uri })),
    );
    expect(subject[`${oidc}dpop_bound_access_tokens`]).toEqual([
      { "@value": true, "@type": "http://www.w3.org/2001/XMLSchema#boolean" },
    ]);
  });

  it("uses the package's canonical federation mappings", () => {
    const vocabulary = JSON.parse(
      readFileSync(
        new URL("../packages/solid-federation-vocab/context.jsonld", import.meta.url),
        "utf8",
      ),
    )["@context"];
    const context = createClientIdDocument(config)["@context"][1];
    expect(context.fedapp).toBe(vocabulary.fedapp);
    for (const term of ["sector", "access", "consumes", "produces", "declaresShape"])
      expect(context[`fedapp:${term}`]).toEqual(vocabulary[term]);
  });

  it("supports optional metadata and deduplicates exact URLs without changing the input", () => {
    const input = structuredClone(config);
    delete input.logo;
    input.origin += "/";
    input.redirectUris.push(input.redirectUris[0]);
    input.fedapp = { sectors: [config.fedapp.sectors[0], config.fedapp.sectors[0]] };
    const original = structuredClone(input);
    const document = createClientIdDocument(input);
    expect(document).not.toHaveProperty("logo_uri");
    expect(document).not.toHaveProperty("fedapp:access");
    expect(document.redirect_uris).toEqual(config.redirectUris);
    expect(document["fedapp:sector"]).toEqual([config.fedapp.sectors[0]]);
    expect(input).toEqual(original);
    expect(clientIdSchema.safeParse(document).success).toBe(true);
    expect(
      createClientIdDocument({ ...input, fedapp: { ...input.fedapp, produces: [] } })[
        "fedapp:produces"
      ],
    ).toEqual([]);
  });

  it.each([
    undefined,
    null,
    [],
    "config",
    {},
    { ...config, client_secret: "fixture-sensitive-value" },
    { ...config, "@context": { client_id: "https://attacker.example" } },
    { ...config, fedapp: { ...config.fedapp, client_secret: "fixture-sensitive-value" } },
    { ...config, fedapp: null },
    { ...config, fedapp: [] },
    ...[undefined, "", " ", 12, "name\n"].map((name) => ({ ...config, name })),
    ...[
      undefined,
      "http://suite.example",
      "https://suite.example/path",
      "https://suite.example?x=y",
      "https://suite.example/#id",
    ].map((origin) => ({ ...config, origin })),
    ...[
      undefined,
      [],
      config.redirectUris[0],
      [null],
      ["/callback"],
      ["https://foreign.example/callback"],
    ].map((redirectUris) => ({ ...config, redirectUris })),
    ...[undefined, [], "https://sector.example/", [12]].map((sectors) => ({
      ...config,
      fedapp: { sectors },
    })),
    { ...config, fedapp: { ...config.fedapp, access: ["https://www.w3.org/ns/auth/acl#Read"] } },
    { ...config, fedapp: { ...config.fedapp, consumes: ["javascript:alert(1)"] } },
    { ...config, fedapp: { ...config.fedapp, produces: "https://shape.example/" } },
    { ...config, logo: null },
  ])("rejects invalid or undocumented config %#", (input) => {
    expect(() => createClientIdDocument(input)).toThrow();
  });

  it.each([
    "http://suite.example/callback",
    "//suite.example/callback",
    "https:callback",
    "javascript:alert(1)",
    "https://user:password@suite.example/callback",
    "https://suite.example/callback#",
    "https://suite.example/callback#code",
    "https://suite.example/callback\n",
    "https://suite.example\\callback",
    "https://suite.example/<callback>",
    "https://suite.example/callback\u0000",
    "https://suite.example/a/../callback",
    "https://SUITE.example/callback",
    "https://suite.example:443/callback",
  ])("rejects unsafe or silently normalized redirect URL %#", (uri) => {
    expect(() => createClientIdDocument({ ...config, redirectUris: [uri] })).toThrow();
  });

  it("writes deterministically under the serving directory and works from another cwd", () => {
    const f = fixture();
    expect(writeClientId(f.path, f.output)).toBe(f.document);
    const first = readFileSync(f.document, "utf8");
    const result = cli([f.path, f.output]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
    expect(readFileSync(f.document, "utf8")).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
    expect(JSON.parse(first)).toEqual(createClientIdDocument(config));
  });

  it.each([
    "{ fixture-sensitive-value",
    JSON.stringify({ ...config, client_secret: "fixture-sensitive-value" }),
  ])("fails without publishing or echoing invalid config %#", (input) => {
    const f = fixture(input);
    const result = cli([f.path, f.output]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("fixture-sensitive-value");
    expect(existsSync(f.output)).toBe(false);
  });

  it("leaves an existing deployment artifact intact when validation fails", () => {
    const f = fixture();
    writeClientId(f.path, f.output);
    const before = readFileSync(f.document, "utf8");
    writeFileSync(f.path, JSON.stringify({ ...config, redirectUris: [] }));
    expect(cli([f.path, f.output]).status).toBe(1);
    expect(readFileSync(f.document, "utf8")).toBe(before);
  });

  it("fails cleanly on missing config or unwritable output", () => {
    const f = fixture();
    for (const args of [
      [join(f.root, "missing"), f.output],
      [f.path, f.path],
    ]) {
      const result = cli(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Client ID generation failed");
      expect(result.stderr).not.toContain("Error:");
    }
  });

  it("reports usage, offers help and imports without running the CLI", () => {
    for (const args of [[], ["config.json"], ["a", "b", "c"], ["--bad", "b"]]) {
      const result = cli(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Usage:");
    }
    expect(cli(["--help"]).status).toBe(0);
    const f = fixture();
    mkdirSync(f.output);
    const result = runCommand(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(entry)})`],
      { cwd: f.output, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
