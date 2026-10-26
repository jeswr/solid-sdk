// AUTHORED-BY Codex GPT-6.1-Sol
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfigPath, readNodeConfig } from "./config.js";

const settings = {
  podRoot: "https://pod.test/alice/",
  webId: "https://pod.test/alice/profile/card#me",
  oidcIssuer: "https://issuer.test/",
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
};
const dirs: string[] = [];
async function config(value: unknown = settings, mode = 0o600) {
  const dir = await mkdtemp(join(tmpdir(), "con03-config-"));
  dirs.push(dir);
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(value), { mode });
  return path;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("MCP configuration file", () => {
  it("accepts explicitly writable MCP settings and a canonical profile document", async () => {
    const cfg = await readNodeConfig(
      await config({
        ...settings,
        readOnly: false,
        profileDocumentUrl: "https://pod.test/alice/profile/resolved",
      }),
    );
    expect(cfg.profileDocumentUrl).toBe("https://pod.test/alice/profile/resolved");
  });
  it("uses the MCP-12 path and loads private credentials plus injected source settings", async () => {
    expect(defaultConfigPath()).toBe(join(homedir(), ".config/solid-mcp/config.json"));
    const cfg = await readNodeConfig(
      await config({
        ...settings,
        tokenUrl: "https://issuer.test/token",
        connectors: {
          spotify: {
            clientId: "public-source",
            clientSecret: "synthetic-source",
            tokenProxyUrl: "https://proxy.test/token",
          },
        },
      }),
    );
    expect(cfg.profileDocumentUrl).toBe("https://pod.test/alice/profile/card");
    expect(cfg.clientId).toBe(settings.clientId);
    expect(cfg.connectors.spotify?.clientId).toBe("public-source");
  });
  it.each([
    0o644, 0o640, 0o400, 0o700, 0o1600,
  ])("refuses mode %o without returning config content", async (mode) => {
    const path = await config();
    await chmod(path, mode);
    await expect(readNodeConfig(path)).rejects.toMatchObject({ kind: "config" });
    await expect(readNodeConfig(path)).rejects.not.toThrow(settings.clientSecret);
  });
  it("refuses symlinks, directories, missing, oversized and invalid JSON files", async () => {
    const path = await config();
    const linked = `${path}.link`;
    await symlink(path, linked);
    await expect(readNodeConfig(linked)).rejects.toMatchObject({ kind: "config" });
    const directory = `${path}.dir`;
    await mkdir(directory);
    await expect(readNodeConfig(directory)).rejects.toMatchObject({ kind: "config" });
    await expect(readNodeConfig(`${path}.missing`)).rejects.toMatchObject({ kind: "config" });
    await writeFile(path, "x".repeat(1024 * 1024 + 1));
    await expect(readNodeConfig(path)).rejects.toMatchObject({ kind: "config" });
    await writeFile(path, "{invalid");
    await expect(readNodeConfig(path)).rejects.toMatchObject({ kind: "config" });
  });
  it.each([
    null,
    [],
    {},
    { ...settings, readOnly: true },
    { ...settings, readOnly: "false" },
    { ...settings, podRoot: "https://pod.test/alice" },
    { ...settings, podRoot: "https://pod.test/alice/?q=x/" },
    { ...settings, oidcIssuer: "http://issuer.test/" },
    { ...settings, tokenUrl: "https://user:pass@issuer.test/token" },
    { ...settings, webId: "not a URL" },
    { ...settings, clientSecret: "" },
    { ...settings, connectors: { "../escape": { clientId: "public" } } },
    { ...settings, connectors: { spotify: { clientId: "" } } },
  ])("rejects malformed or unsafe settings #%#", async (value) => {
    await expect(readNodeConfig(await config(value))).rejects.toMatchObject({ kind: "config" });
  });
});
