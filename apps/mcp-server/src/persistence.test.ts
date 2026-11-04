// AUTHORED-BY Codex GPT-6.1-Sol
import { createSessionVault, type Grant, MemoryVaultStore } from "@jeswr/mcp-oauth";
import { expect, it } from "vitest";
import { createVaultOAuthStores, vaultSigningKey } from "./persistence.js";

it("atomically consumes once across workers and retains replay evidence", async () => {
  const vault = createSessionVault({
    key: Buffer.alloc(32, 7).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const a = createVaultOAuthStores(vault, "issuer");
  const b = createVaultOAuthStores(vault, "issuer");
  const value = {
    authorization: {
      clientId: "client",
      redirectUri: "https://example.org/",
      resource: "https://mcp.example/mcp",
      state: "state",
      scope: "mcp",
      challenge: "pkce",
    },
    grantId: "grant",
    expiresAt: 123,
  };
  await a.codes.put("code-hash", value);
  const results = await Promise.all([a.codes.consume("code-hash"), b.codes.consume("code-hash")]);
  expect(results.filter((r) => r?.firstUse)).toHaveLength(1);
  expect(await b.codes.consume("code-hash")).toEqual({ firstUse: false, value });
  expect(await a.codes.consume("missing")).toBeUndefined();
  await expect(a.codes.put("code-hash", value)).rejects.toThrow("collision");
  const snapshot = await a.codes.get("code-hash");
  if (snapshot) snapshot.grantId = "changed";
  expect((await b.codes.get("code-hash"))?.grantId).toBe("grant");
  expect(
    await createVaultOAuthStores(vault, "other-issuer").codes.get("code-hash"),
  ).toBeUndefined();
});

it("keeps grant and session revocation irreversible under concurrent workers", async () => {
  const vault = createSessionVault({
    key: Buffer.alloc(32, 7).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const a = createVaultOAuthStores(vault, "issuer");
  const b = createVaultOAuthStores(vault, "issuer");
  const grant: Grant = {
    id: "g",
    clientId: "client",
    session: { id: "session", webId: "https://pod.example/#me" },
    resource: "https://mcp.example/mcp",
    scope: "mcp",
    expiresAt: 123,
    revoked: false,
    refreshAllowed: true,
  };
  await a.grants.put("g", grant);
  await Promise.all([
    a.grants.revoke("g"),
    b.grants.revoke("g"),
    a.grants.revokeSession("session"),
    b.grants.revokeSession("session"),
  ]);
  expect((await b.grants.get("g"))?.revoked).toBe(true);
  expect(await b.grants.isSessionRevoked("session")).toBe(true);
  await expect(a.grants.put("g", grant)).rejects.toThrow();
  await a.grants.revoke("missing");
  const keys = await Promise.all([
    vaultSigningKey(vault, "issuer"),
    vaultSigningKey(vault, "issuer"),
  ]);
  expect(keys[0]?.kid).toBe(keys[1]?.kid);
  expect(keys[0]?.privateKey.export({ type: "pkcs8", format: "pem" })).toBe(
    keys[1]?.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
});
