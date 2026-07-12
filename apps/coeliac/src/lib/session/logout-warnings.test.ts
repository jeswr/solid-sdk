// AUTHORED-BY Claude Opus 4.8
import { describe, expect, it } from "vitest";
import type { LogoutOutcome } from "./logout";
import {
  clearPurgeWarning,
  clearRevokeWarning,
  PURGE_WARNING,
  REVOKE_WARNING,
  warningsFromOutcome,
  withPurgeWarning,
} from "./logout-warnings";

const clean: LogoutOutcome = { purgeFailed: false, revokeFailed: false };
const revokeOnly: LogoutOutcome = { purgeFailed: false, revokeFailed: true, revokeError: "boom" };
const purgeOnly: LogoutOutcome = { purgeFailed: true, revokeFailed: false, error: "blocked" };
const both: LogoutOutcome = {
  purgeFailed: true,
  revokeFailed: true,
  error: "blocked",
  revokeError: "boom",
};

describe("warningsFromOutcome", () => {
  it("a clean sign-out yields no warnings", () => {
    expect(warningsFromOutcome(clean)).toEqual({ purgeWarning: null, revokeWarning: null });
  });

  it("(a) a revoke-ONLY failure yields a revoke warning and NO purge warning", () => {
    // No purgeWarning ⇒ the provider retains no store and shows no "Clear local data".
    expect(warningsFromOutcome(revokeOnly)).toEqual({
      purgeWarning: null,
      revokeWarning: REVOKE_WARNING,
    });
  });

  it("a purge-only failure yields a purge warning and NO revoke warning", () => {
    expect(warningsFromOutcome(purgeOnly)).toEqual({
      purgeWarning: PURGE_WARNING,
      revokeWarning: null,
    });
  });

  it("a combined failure yields BOTH warnings, independently", () => {
    expect(warningsFromOutcome(both)).toEqual({
      purgeWarning: PURGE_WARNING,
      revokeWarning: REVOKE_WARNING,
    });
  });
});

describe("independent clearing — resolving one warning never hides the other", () => {
  it("(a) a purge retry (clearPurgeWarning) canNOT clear a revoke-only warning", () => {
    const w = warningsFromOutcome(revokeOnly);
    // Even if the purge path runs its clear, the revoke security warning must persist.
    const after = clearPurgeWarning(w);
    expect(after.revokeWarning).toBe(REVOKE_WARNING);
    expect(after.purgeWarning).toBeNull();
  });

  it("(b) on a combined failure, a successful purge retry clears purge but revoke PERSISTS", () => {
    const w = warningsFromOutcome(both);
    const after = clearPurgeWarning(w);
    expect(after.purgeWarning).toBeNull();
    expect(after.revokeWarning).toBe(REVOKE_WARNING); // still-live session risk stays visible
  });

  it("(b) a FAILED purge retry updates purge text but leaves revoke intact", () => {
    const w = warningsFromOutcome(both);
    const after = withPurgeWarning(w, "Still could not clear local health data: blocked");
    expect(after.purgeWarning).toBe("Still could not clear local health data: blocked");
    expect(after.revokeWarning).toBe(REVOKE_WARNING);
  });

  it("(c) clearRevokeWarning clears ONLY the revoke warning; the purge warning survives", () => {
    const w = warningsFromOutcome(both);
    const after = clearRevokeWarning(w);
    expect(after.revokeWarning).toBeNull();
    expect(after.purgeWarning).toBe(PURGE_WARNING);
  });

  it("(c) a revoke warning is not touched by the purge clear, and vice-versa (symmetry)", () => {
    const w = warningsFromOutcome(both);
    // Clear purge then revoke ⇒ both gone; order-independent, each clears only its own.
    expect(clearRevokeWarning(clearPurgeWarning(w))).toEqual({
      purgeWarning: null,
      revokeWarning: null,
    });
    expect(clearPurgeWarning(clearRevokeWarning(w))).toEqual({
      purgeWarning: null,
      revokeWarning: null,
    });
  });
});
