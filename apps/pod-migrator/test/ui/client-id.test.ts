// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  clientDocumentPlugin,
  clientIdDocument,
  deploymentBasePath,
  deploymentOrigin,
  originEnvironment,
} from "../../vite.config.js";

describe("static client identifier document", () => {
  it("merges environment fields independently, in precedence order, ignoring empty values", () => {
    const env = originEnvironment([
      { APP_ORIGIN: "", APP_BASE_PATH: "/solid-sdk/pod-migrator/" },
      { APP_ORIGIN: "https://local-file.example" },
      { APP_ORIGIN: "https://base-file.example", APP_BASE_PATH: "/" },
    ]);
    expect(deploymentOrigin(env, true)).toBe("https://local-file.example");
    expect(env.APP_BASE_PATH).toBe("/solid-sdk/pod-migrator/");
    expect(
      deploymentOrigin(originEnvironment([{ APP_ORIGIN: "https://shell.example" }, env]), true),
    ).toBe("https://shell.example");
  });

  it("uses one deployment origin and base for the client and both callback paths", () => {
    const origin = deploymentOrigin({ APP_ORIGIN: "https://jeswr.github.io/" }, true);
    expect(clientIdDocument(origin, "/solid-sdk/pod-migrator/")).toEqual({
      "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
      client_id: "https://jeswr.github.io/solid-sdk/pod-migrator/clientid.jsonld",
      client_name: "Pod Migrator",
      client_uri: "https://jeswr.github.io/solid-sdk/pod-migrator/",
      redirect_uris: [
        "https://jeswr.github.io/solid-sdk/pod-migrator/callback/source",
        "https://jeswr.github.io/solid-sdk/pod-migrator/callback/target",
      ],
      scope: "openid webid offline_access",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(clientIdDocument(origin).client_id).toBe("https://jeswr.github.io/clientid.jsonld");
    expect(deploymentOrigin({})).toBe("http://localhost:5173");
    expect(() => deploymentOrigin({}, true)).toThrow("Set APP_ORIGIN");
    expect(() => deploymentOrigin({ APP_ORIGIN: "http://localhost:5173" }, true)).toThrow();
    expect(deploymentOrigin({ APP_ORIGIN: "http://localhost:5173" })).toBe("http://localhost:5173");
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

  it("requires a safe absolute base with a trailing slash", () => {
    expect(deploymentBasePath()).toBe("/");
    expect(deploymentBasePath("/solid-sdk/pod-migrator/")).toBe("/solid-sdk/pod-migrator/");
    for (const path of [
      "",
      "relative/",
      "//evil/",
      "/path",
      "/../",
      "/%2f/",
      "/a/?x",
      "/a/#x",
      "/a\\/",
    ])
      expect(() => deploymentBasePath(path)).toThrow("APP_BASE_PATH");
  });

  it("emits an identical static 404 entry and the base-aware client document", () => {
    const plugin = clientDocumentPlugin("https://jeswr.github.io", "/solid-sdk/pod-migrator/");
    const emitFile = vi.fn();
    const hook = plugin.generateBundle;
    if (!hook || typeof hook !== "object") throw new Error("Expected an ordered build hook");
    const run = hook.handler as unknown as (
      this: { emitFile: typeof emitFile },
      options: unknown,
      bundle: unknown,
    ) => void;
    const html = '<html><script src="/solid-sdk/pod-migrator/assets/app.js"></script></html>';
    run.call({ emitFile }, {}, { "index.html": { type: "asset", source: html } });
    expect(emitFile).toHaveBeenCalledWith({ type: "asset", fileName: "404.html", source: html });
    for (const id of ["source", "target"])
      expect(emitFile).toHaveBeenCalledWith({
        type: "asset",
        fileName: `callback/${id}/index.html`,
        source: html,
      });
    const cid = emitFile.mock.calls.find(([asset]) => asset.fileName === "clientid.jsonld")?.[0];
    expect(JSON.parse(cid.source)).toEqual(
      clientIdDocument("https://jeswr.github.io", "/solid-sdk/pod-migrator/"),
    );
    expect(() => run.call({ emitFile }, {}, {})).toThrow("Missing built index.html");
  });
});
