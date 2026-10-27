// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientIdDocument, deploymentOrigin, originEnvironment } from "../../vite.config.js";

describe("static client identifier document", () => {
  it("resolves the origin per env layer and ignores empty shell values", () => {
    const layers = [
      { APP_ORIGIN: "" },
      { APP_ORIGIN: "https://local-file.example" },
      { APP_ORIGIN: "https://base-file.example" },
    ];
    expect(deploymentOrigin(originEnvironment(layers), true)).toBe("https://local-file.example");
    expect(
      deploymentOrigin(originEnvironment([{ VERCEL_URL: "preview.vercel.app" }, ...layers]), true),
    ).toBe("https://preview.vercel.app");
    expect(
      deploymentOrigin(
        originEnvironment([{ APP_ORIGIN: "https://shell.example" }, ...layers]),
        true,
      ),
    ).toBe("https://shell.example");
  });
  it("uses one deployment origin for the client and both callback paths", () => {
    const origin = deploymentOrigin(
      { APP_ORIGIN: "https://migrate.example/", VERCEL_URL: "preview.vercel.app" },
      true,
    );
    expect(clientIdDocument(origin)).toEqual({
      "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
      client_id: "https://migrate.example/clientid.jsonld",
      client_name: "Pod Migrator",
      client_uri: "https://migrate.example/",
      redirect_uris: [
        "https://migrate.example/callback/source",
        "https://migrate.example/callback/target",
      ],
      scope: "openid webid offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(deploymentOrigin({ VERCEL_URL: "preview.vercel.app" }, true)).toBe(
      "https://preview.vercel.app",
    );
    expect(deploymentOrigin({ APP_ORIGIN: "", VERCEL_URL: "preview.vercel.app" }, true)).toBe(
      "https://preview.vercel.app",
    );
    expect(deploymentOrigin({})).toBe("http://localhost:5173");
    expect(() => deploymentOrigin({}, true)).toThrow("Set APP_ORIGIN");
  });

  it.each([
    "http://app.example",
    "https://user:pass@app.example",
    "https://app.example/path",
    "https://app.example?x=1",
    "https://app.example#x",
    "javascript:alert(1)",
  ])("rejects an unsafe or mismatched origin %s", (origin) => {
    expect(() => deploymentOrigin({ APP_ORIGIN: origin }, true)).toThrow();
  });

  it("serves JSON-LD with CORS and rewrites both callback routes to the SPA", () => {
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    const headers = config.headers.find(
      (entry: { source: string }) => entry.source === "/clientid.jsonld",
    ).headers;
    expect(headers).toContainEqual({ key: "Content-Type", value: "application/ld+json" });
    expect(headers).toContainEqual({ key: "Access-Control-Allow-Origin", value: "*" });
    const rule = config.rewrites[0];
    const pattern = new RegExp(`^${rule.source}$`);
    expect(pattern.test("/callback/source")).toBe(true);
    expect(pattern.test("/callback/target")).toBe(true);
    expect(pattern.test("/clientid.jsonld")).toBe(false);
    expect(rule.destination).toBe("/index.html");
  });
});
