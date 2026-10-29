// AUTHORED-BY Codex GPT-6.1-Sol
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCliConfig } from "../src/cli-config.js";

const POD = "https://pod.example/alice/";
let home: string;
let path: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solid-mcp-config-"));
  path = join(home, ".config/solid-mcp/config.json");
  await mkdir(join(home, ".config/solid-mcp"), { recursive: true });
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
async function file(value: unknown, mode = 0o600) {
  await writeFile(path, JSON.stringify(value), { mode });
}

describe("CLI config", () => {
  it("keeps anonymous mode and read-only defaults when no auth is configured", async () => {
    expect(await loadCliConfig({ SOLID_MCP_POD_ROOT: POD }, home)).toMatchObject({
      podRoot: POD,
      readOnly: true,
    });
    await expect(loadCliConfig({}, home)).rejects.toThrow(/required/);
  });
  it("reads a 0600 config and applies environment overrides", async () => {
    await file({
      podRoot: POD,
      readOnly: false,
      clientId: "fixture-id",
      clientSecret: "fixture-secret",
      oidcIssuer: "https://issuer.example/",
      webId: `${POD}profile#me`,
    });
    expect(
      await loadCliConfig(
        {
          SOLID_MCP_POD_ROOT: "https://other.example/",
          SOLID_MCP_READONLY: "TRUE",
          SOLID_MCP_CLIENT_SECRET: "override-fixture",
        },
        home,
      ),
    ).toMatchObject({
      podRoot: "https://other.example/",
      readOnly: true,
      clientId: "fixture-id",
      clientSecret: "override-fixture",
      oidcIssuer: "https://issuer.example/",
      webId: `${POD}profile#me`,
    });
  });
  it.each([
    0o644, 0o400, 0o660, 0o700, 0o1600,
  ])("rejects a config with mode %s, including with env overrides", async (mode) => {
    await file({ podRoot: POD });
    await chmod(path, mode);
    await expect(loadCliConfig({ SOLID_MCP_POD_ROOT: POD }, home)).rejects.toThrow(/0600/);
  });
  it("refuses symlinks and directories", async () => {
    const target = join(home, "target.json");
    await writeFile(target, JSON.stringify({ podRoot: POD }), { mode: 0o600 });
    await symlink(target, path);
    await expect(loadCliConfig({}, home)).rejects.toThrow(/regular 0600/);
    await rm(path);
    await mkdir(path, { mode: 0o600 });
    await expect(loadCliConfig({}, home)).rejects.toThrow(/regular file/);
  });
  it.each([
    null,
    [],
    "fixture",
    { podRoot: POD, readOnly: "false" },
    { podRoot: POD, clientId: "id" },
  ])("rejects malformed config %j", async (value) => {
    await file(value);
    await expect(loadCliConfig({}, home)).rejects.toThrow();
  });
  it("does not disclose malformed JSON content", async () => {
    await writeFile(path, "{fixture-secret", { mode: 0o600 });
    await expect(loadCliConfig({}, home)).rejects.toThrow("must contain valid JSON");
  });
  it.each([
    { SOLID_MCP_CLIENT_ID: "id" },
    { SOLID_MCP_CLIENT_SECRET: "fixture-secret" },
    { SOLID_MCP_OIDC_ISSUER: "https://issuer.example/" },
    { SOLID_MCP_READONLY: "maybe" },
    { SOLID_MCP_POD_ROOT: "https://user:fixture-secret@pod.example/" },
    { SOLID_MCP_POD_ROOT: "https://pod.example/no-slash" },
    { SOLID_MCP_CLIENT_ID: "" },
  ])("fails closed on invalid environment %j", async (env) => {
    await expect(loadCliConfig({ SOLID_MCP_POD_ROOT: POD, ...env }, home)).rejects.toThrow();
  });
  it("accepts token URL without an issuer and HTTP loopback development", async () => {
    expect(
      await loadCliConfig(
        {
          SOLID_MCP_POD_ROOT: "http://localhost:3000/pod/",
          SOLID_MCP_CLIENT_ID: "id",
          SOLID_MCP_CLIENT_SECRET: "fixture",
          SOLID_MCP_TOKEN_URL: "http://localhost:3000/.oidc/token",
          SOLID_MCP_READONLY: "false",
        },
        home,
      ),
    ).toMatchObject({ readOnly: false });
  });
  it.each([
    "http://issuer.example/",
    "https://user:fixture@issuer.example/",
    "file:///tmp/issuer",
    "not-a-url",
  ])("refuses unsafe auth URL %s", async (issuer) => {
    await expect(
      loadCliConfig(
        {
          SOLID_MCP_POD_ROOT: POD,
          SOLID_MCP_CLIENT_ID: "id",
          SOLID_MCP_CLIENT_SECRET: "fixture",
          SOLID_MCP_OIDC_ISSUER: issuer,
        },
        home,
      ),
    ).rejects.toThrow(/Invalid pod\/auth URL/);
  });
});
