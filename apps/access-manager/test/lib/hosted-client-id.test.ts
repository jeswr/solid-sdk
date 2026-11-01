// AUTHORED-BY Codex GPT-5.6 (Sol)
// AUTHORED-BY Codex GPT-6

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostedClientIdConfig } from "../../src/lib/hosted-client-id.js";

const template = JSON.parse(
  readFileSync(new URL("../../public/clientid.jsonld", import.meta.url), "utf8"),
);

function generated(env: Record<string, string>) {
  const config = hostedClientIdConfig(env, template);
  const plugin = config.plugins?.[0];
  if (!plugin) throw new Error("Expected the hosted client ID plugin");
  const assets: { type: "asset"; fileName: string; source: string }[] = [];
  plugin.generateBundle.call({ emitFile: (asset) => assets.push(asset) });
  expect(plugin.apply).toBe("build");
  expect(assets).toHaveLength(1);
  const asset = assets[0];
  if (!asset) throw new Error("Expected the emitted client ID document");
  expect(asset.type).toBe("asset");
  expect(asset.fileName).toBe("clientid.jsonld");
  return { config, document: JSON.parse(asset.source) };
}

describe("hosted client ID", () => {
  it("includes the Pages base in browser identity, callback and logout URLs", () => {
    const base = "https://jeswr.github.io/solid-sdk/access-manager/";
    const { config, document } = generated({
      APP_ORIGIN: "https://jeswr.github.io",
      CLIENT_BASE_PATH: "/solid-sdk/access-manager/",
    });
    expect(document.client_id).toBe(`${base}clientid.jsonld`);
    expect(document.client_uri).toBe(base);
    expect(document.redirect_uris).toEqual([`${base}callback.html`]);
    expect(document.post_logout_redirect_uris).toEqual([base]);
    expect(JSON.parse(config.define?.["import.meta.env.VITE_CLIENT_ID"] ?? "null")).toBe(
      document.client_id,
    );
  });

  it.each([
    "https://other.example/",
    "//other.example/",
    "/missing-slash",
    "/query?x/",
    "/hash#x/",
  ])("rejects invalid client base %s", (basePath) => {
    expect(() =>
      generated({ APP_ORIGIN: "https://jeswr.github.io", CLIENT_BASE_PATH: basePath }),
    ).toThrow("CLIENT_BASE_PATH");
  });

  it("emits HTTPS metadata and uses the same client ID in the browser", () => {
    const origin = "https://access.example:8443";
    const { config, document } = generated({ APP_ORIGIN: `${origin}/` });
    expect(document).toEqual({
      ...template,
      client_id: `${origin}/clientid.jsonld`,
      client_uri: origin,
      redirect_uris: [`${origin}/callback.html`],
      post_logout_redirect_uris: [origin],
    });
    expect(JSON.parse(config.define?.["import.meta.env.VITE_CLIENT_ID"] ?? "null")).toBe(
      document.client_id,
    );
  });

  it("gives an explicit VITE_CLIENT_ID precedence without changing hosted metadata", () => {
    const origin = "https://access.example";
    const clientId = "https://identity.example/custom-client.jsonld";
    const { config, document } = generated({ APP_ORIGIN: origin, VITE_CLIENT_ID: clientId });
    expect(JSON.parse(config.define?.["import.meta.env.VITE_CLIENT_ID"] ?? "null")).toBe(clientId);
    expect(document.client_id).toBe(`${origin}/clientid.jsonld`);
  });

  it.each([
    {},
    { APP_ORIGIN: "" },
    { VITE_CLIENT_ID: "https://identity.example/client.jsonld" },
  ])("keeps existing Vite behavior without APP_ORIGIN: %j", (env) => {
    expect(hostedClientIdConfig(env, template)).toEqual({});
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("allows HTTP on loopback host %s", (host) => {
    const origin = `http://${host}:5173`;
    const { document } = generated({ APP_ORIGIN: origin });
    expect(document.client_id).toBe(`${origin}/clientid.jsonld`);
    expect(document.redirect_uris).toEqual([`${origin}/callback.html`]);
  });

  it.each([
    "http://solid-access-manager.vercel.app",
    "http://localhost.example",
    "http://127.0.0.1.example",
    "http://192.168.1.1",
    "ftp://localhost",
  ])("rejects an insecure or unsupported origin: %s", (origin) => {
    expect(() => hostedClientIdConfig({ APP_ORIGIN: origin }, template)).toThrow(
      "APP_ORIGIN must use https: (http: is allowed only for localhost, 127.0.0.1, or [::1])",
    );
  });
});
