/**
 * Offline unit suite for the session store: serialise/deserialise round-trips an AuthCodeSession
 * (preserving the DPoP `jkt`), persists at `0600`, reconstructs a usable signing keypair, and
 * handles a missing file. No CSS / no network.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AuthCodeSession,
  createDpopProof,
  deserializeSession,
  generateDpopKeyPair,
  loadSession,
  type StoredSession,
  saveSession,
  serializeSession,
} from "../src/index.js";

async function makeSession(): Promise<AuthCodeSession> {
  const keyPair = await generateDpopKeyPair();
  return {
    keyPair,
    accessToken: "access-token-abc",
    expiresAt: Date.now() + 300_000,
    refreshToken: "refresh-token-xyz",
    nonce: "server-nonce-1",
    client: { client_id: "client-123", redirect_uris: ["http://127.0.0.1:8080/callback"] },
    providerMetadata: {
      issuer: "http://localhost:3000/",
      authorization_endpoint: "http://localhost:3000/.oidc/auth",
      token_endpoint: "http://localhost:3000/.oidc/token",
      registration_endpoint: "http://localhost:3000/.oidc/reg",
    },
  };
}

describe("sessionStore serialize/deserialize", () => {
  it("round-trips a session preserving the DPoP jkt (so refresh keeps its binding)", async () => {
    const session = await makeSession();
    const stored = await serializeSession(session);
    expect(stored.version).toBe(1);
    expect(stored.keyPairJwk.d).toBeTruthy(); // private component persisted (required for refresh)
    expect(stored.refreshToken).toBe("refresh-token-xyz");

    const back = await deserializeSession(stored);
    expect(back.keyPair.thumbprint).toBe(session.keyPair.thumbprint);
    expect(back.accessToken).toBe(session.accessToken);
    expect(back.expiresAt).toBe(session.expiresAt);
    expect(back.refreshToken).toBe(session.refreshToken);
    expect(back.nonce).toBe(session.nonce);
    expect(back.client.client_id).toBe("client-123");
    expect(back.providerMetadata.token_endpoint).toBe("http://localhost:3000/.oidc/token");
  });

  it("the reconstructed keypair can mint a valid DPoP proof", async () => {
    const session = await makeSession();
    const back = await deserializeSession(await serializeSession(session));
    const proof = await createDpopProof({
      keyPair: back.keyPair,
      htm: "GET",
      htu: "http://localhost:3000/x",
    });
    // A JWS is three base64url segments.
    expect(proof.split(".")).toHaveLength(3);
  });

  it("survives a JSON disk round-trip (stringify/parse) with the jkt intact", async () => {
    const session = await makeSession();
    const stored = await serializeSession(session);
    const json = JSON.parse(JSON.stringify(stored)) as StoredSession;
    const back = await deserializeSession(json);
    expect(back.keyPair.thumbprint).toBe(session.keyPair.thumbprint);
  });

  it("rejects an unsupported store version", async () => {
    const session = await makeSession();
    const stored = {
      ...(await serializeSession(session)),
      version: 99,
    } as unknown as StoredSession;
    await expect(deserializeSession(stored)).rejects.toThrow(/Unsupported session store version/);
  });

  it("omits refreshToken/nonce when absent", async () => {
    const session = await makeSession();
    delete (session as { refreshToken?: string }).refreshToken;
    delete (session as { nonce?: string }).nonce;
    const stored = await serializeSession(session);
    expect("refreshToken" in stored).toBe(false);
    expect("nonce" in stored).toBe(false);
    const back = await deserializeSession(stored);
    expect(back.refreshToken).toBeUndefined();
  });
});

describe("sessionStore save/load (disk, 0600)", () => {
  it("writes the file 0600 and loads it back with a matching jkt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "session-store-"));
    const path = join(dir, "auth", "auth.json");
    try {
      const session = await makeSession();
      await saveSession(path, session);

      const st = await stat(path);
      // Owner-only perms (0600). On POSIX the low 9 bits are the mode.
      expect(st.mode & 0o777).toBe(0o600);

      // The on-disk content is the StoredSession JSON.
      const parsed = JSON.parse(await readFile(path, "utf8")) as StoredSession;
      expect(parsed.version).toBe(1);

      const loaded = await loadSession(path);
      expect(loaded).toBeDefined();
      expect(loaded!.keyPair.thumbprint).toBe(session.keyPair.thumbprint);
      expect(loaded!.refreshToken).toBe(session.refreshToken);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "session-store-missing-"));
    try {
      const loaded = await loadSession(join(dir, "does-not-exist.json"));
      expect(loaded).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("re-tightens perms on an existing looser file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "session-store-retighten-"));
    const path = join(dir, "auth.json");
    try {
      const session = await makeSession();
      // First write loose, then saveSession must clamp to 0600.
      await import("node:fs/promises").then((fs) => fs.writeFile(path, "{}", { mode: 0o644 }));
      await saveSession(path, session);
      const st = await stat(path);
      expect(st.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
