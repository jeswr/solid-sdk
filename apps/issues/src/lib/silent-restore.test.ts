import { describe, it, expect } from "vitest";
import {
  classifyRestoreError,
  shouldAttemptRestore,
  shouldClearStoredSession,
  type PersistedSessionMeta,
} from "./silent-restore";

const meta = (p: Partial<PersistedSessionMeta> = {}): PersistedSessionMeta => ({
  webId: "https://alice.example/profile/card#me",
  issuer: "https://idp.example",
  storageUrl: "https://alice.example/",
  hasRefreshToken: true,
  ...p,
});

describe("shouldAttemptRestore — the silent-restore decision (pss-203m)", () => {
  it("attempts when there is a stored session with a refresh token", () => {
    expect(shouldAttemptRestore(meta())).toBe(true);
  });

  it("does NOT attempt when there is no stored session", () => {
    expect(shouldAttemptRestore(null)).toBe(false);
  });

  it("does NOT attempt without a refresh token", () => {
    expect(shouldAttemptRestore(meta({ hasRefreshToken: false }))).toBe(false);
  });

  it("does NOT attempt when essential fields are missing", () => {
    expect(shouldAttemptRestore(meta({ webId: "" }))).toBe(false);
    expect(shouldAttemptRestore(meta({ issuer: "" }))).toBe(false);
  });

  it("does NOT attempt when a known refresh expiry has already passed (with skew)", () => {
    const now = 1_000_000_000_000;
    expect(shouldAttemptRestore(meta({ refreshExpiresAt: now - 1 }), now)).toBe(false);
    // within the skew window is also treated as expired
    expect(shouldAttemptRestore(meta({ refreshExpiresAt: now + 10_000 }), now, 30_000)).toBe(false);
    // comfortably in the future → attempt
    expect(shouldAttemptRestore(meta({ refreshExpiresAt: now + 3_600_000 }), now)).toBe(true);
  });

  it("attempts when the refresh expiry is unknown (the grant call is the authority)", () => {
    expect(shouldAttemptRestore(meta({ refreshExpiresAt: undefined }))).toBe(true);
  });
});

describe("classifyRestoreError — dead vs transient", () => {
  it("invalid_grant ⇒ expired (force a fresh login, purge the token)", () => {
    const out = classifyRestoreError({ error: "invalid_grant" });
    expect(out.kind).toBe("expired");
    expect(shouldClearStoredSession(out)).toBe(true);
  });

  it("reads an OAuth error nested under .cause", () => {
    expect(classifyRestoreError({ cause: { error: "invalid_token" } }).kind).toBe("expired");
  });

  it("a network failure (TypeError) ⇒ transient, and the token is kept", () => {
    const out = classifyRestoreError(new TypeError("Failed to fetch"));
    expect(out.kind).toBe("transient");
    expect(shouldClearStoredSession(out)).toBe(false);
  });

  it("an unclassifiable error fails safe to expired (never silently trusted)", () => {
    expect(classifyRestoreError(new Error("???")).kind).toBe("expired");
    expect(classifyRestoreError("weird").kind).toBe("expired");
  });
});
