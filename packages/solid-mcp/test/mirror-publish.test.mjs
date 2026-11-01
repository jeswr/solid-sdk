// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rewriteManifest } from "../../../scripts/mirror-publish.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dist = new URL("../dist/", import.meta.url);

describe("MCP mirror artifacts", () => {
  it("publishes without a private mcp-oauth mirror SHA", () => {
    const sha = "a".repeat(40);
    const external = ["@jeswr/guarded-fetch", "@jeswr/rdf-serialize", "@jeswr/solid-chat-interop"];
    const mirror = rewriteManifest(manifest, new Map(external.map((name) => [name, sha])));
    expect(mirror.dependencies).not.toHaveProperty("@jeswr/mcp-oauth");
    for (const name of external) {
      expect(mirror.dependencies[name]).toBe(`github:jeswr/${name.slice("@jeswr/".length)}#${sha}`);
    }
  });

  it("emits JavaScript and declarations without a private mcp-oauth import", () => {
    const files = readdirSync(dist, { recursive: true });
    for (const extension of [".js", ".d.ts"]) {
      const artifacts = files.filter((name) => name.endsWith(extension));
      expect(artifacts.length).toBeGreaterThan(0);
      for (const name of artifacts) {
        expect(readFileSync(new URL(name, dist), "utf8"), name).not.toContain("@jeswr/mcp-oauth");
      }
    }
  });

  it.each([
    ["https://mcp.example/", "https://mcp.example/.well-known/oauth-protected-resource"],
    ["https://mcp.example/mcp", "https://mcp.example/.well-known/oauth-protected-resource/mcp"],
    [
      "https://mcp.example/nested/mcp/",
      "https://mcp.example/.well-known/oauth-protected-resource/nested/mcp",
    ],
  ])("retains the bundled HTTP metadata challenge for %s", async (resourceUrl, metadata) => {
    const { createMcpHttpHandler } = await import("../dist/http.js");
    const handler = createMcpHttpHandler({
      resourceUrl,
      allowedOrigins: [],
      authenticate: () => null,
      server: () => {
        throw new Error("Unauthenticated request must not create a server");
      },
    });
    const response = await handler(new Request(resourceUrl, { method: "POST" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${metadata}"`);
  });
});
