// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the SECURITY-CRITICAL silent-restore teardown/keep-drop wiring in the
// SessionProvider — `applySilentRestoreDecision`, the pure (over injected deps) branch
// that turns a `decideSilentRestore` outcome into the durable + in-memory + pointer
// side effects + the rendered SilentRestoreOutcome. roborev flagged that this branch
// (reset → forgetPersisted → clear pointer → derive/keep) was only tested at the
// `decideSilentRestore`/provider level, not as the SessionProvider wiring. This pins
// all three outcomes — and, crucially, the FAIL-CLOSED `webid-mismatch` teardown ORDER
// (reset() BEFORE forgetPersisted) — with no React harness / real provider / IndexedDB.
//
// SessionProvider imports @solid/reactive-authentication only as a TYPE (erased at
// runtime) and loads its runtime via a dynamic import inside an effect, so importing
// these pure helpers at module top-level pulls in no browser-only runtime.
import type { CredentialPresence, SessionRestoreDecision } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySilentRestoreDecision, type SilentRestoreDeps } from "./SessionProvider";
import type { DerivedSession } from "./session-derivation";

const ALICE = "https://alice.example/profile/card#me";
const ISSUER = "https://issuer.example/";
const SESSION: DerivedSession = {
  podRoot: "https://alice.example/",
  webId: ALICE,
  podRootIsFallback: false,
};

// A deps double recording the ORDER of the security-critical side effects.
function makeDeps(overrides: Partial<SilentRestoreDeps> = {}) {
  const calls: string[] = [];
  const deps: SilentRestoreDeps = {
    reset: vi.fn(() => void calls.push("reset")),
    forgetPersisted: vi.fn(async () => void calls.push("forgetPersisted")),
    credentialPresence: vi.fn(async () => "absent" as CredentialPresence),
    pointer: {
      write: vi.fn(() => void calls.push("pointer.write")),
      clear: vi.fn(() => void calls.push("pointer.clear")),
    },
    deriveSessionFor: vi.fn(async () => {
      calls.push("deriveSessionFor");
      return SESSION;
    }),
    ...overrides,
  };
  return { deps, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("applySilentRestoreDecision — RESTORED", () => {
  it("re-writes the pointer and returns a restored outcome", async () => {
    const { deps } = makeDeps();
    const decision: SessionRestoreDecision = { outcome: "restored", webId: ALICE, issuer: ISSUER };
    const outcome = await applySilentRestoreDecision(
      decision,
      { webId: ALICE, issuer: ISSUER },
      deps,
    );
    expect(outcome).toEqual({ kind: "restored", webId: ALICE, session: SESSION });
    expect(deps.pointer.write).toHaveBeenCalledWith(ALICE, ISSUER);
    // A restore NEVER tears down (no reset / forget / clear).
    expect(deps.reset).not.toHaveBeenCalled();
    expect(deps.forgetPersisted).not.toHaveBeenCalled();
    expect(deps.pointer.clear).not.toHaveBeenCalled();
  });
});

describe("applySilentRestoreDecision — FAIL-CLOSED webid-mismatch teardown", () => {
  it("tears down IN ORDER: reset() FIRST, THEN forgetPersisted, THEN clear pointer", async () => {
    const { deps, calls } = makeDeps();
    const decision: SessionRestoreDecision = { outcome: "login", reason: "webid-mismatch" };
    const outcome = await applySilentRestoreDecision(
      decision,
      { webId: ALICE, issuer: ISSUER },
      deps,
    );
    expect(outcome).toEqual({ kind: "login" });
    // reset() MUST precede the awaited forgetPersisted (so no patched fetch can upgrade
    // as the wrong WebID during the IndexedDB delete window), then the pointer is cleared.
    expect(calls).toEqual(["reset", "forgetPersisted", "pointer.clear"]);
    expect(deps.forgetPersisted).toHaveBeenCalledWith(new URL(ISSUER));
    // The keep/drop matrix is NOT consulted on a mismatch — it is an unconditional drop.
    expect(deps.credentialPresence).not.toHaveBeenCalled();
  });

  it("still resets + clears the pointer when the remembered issuer is malformed (no forget)", async () => {
    const { deps, calls } = makeDeps();
    const decision: SessionRestoreDecision = { outcome: "login", reason: "webid-mismatch" };
    await applySilentRestoreDecision(decision, { webId: ALICE, issuer: "not a url" }, deps);
    // reset() + pointer.clear() still fire; forgetPersisted is skipped (no usable issuer).
    expect(calls).toEqual(["reset", "pointer.clear"]);
    expect(deps.forgetPersisted).not.toHaveBeenCalled();
  });
});

describe("applySilentRestoreDecision — restore-failed keep/drop matrix", () => {
  it("DROPS the pointer when the credential is absent (a definitive dead token)", async () => {
    const { deps } = makeDeps({
      credentialPresence: vi.fn(async (): Promise<CredentialPresence> => "absent"),
    });
    const decision: SessionRestoreDecision = { outcome: "login", reason: "restore-failed" };
    const outcome = await applySilentRestoreDecision(
      decision,
      { webId: ALICE, issuer: ISSUER },
      deps,
    );
    expect(outcome).toEqual({ kind: "login" });
    expect(deps.pointer.clear).toHaveBeenCalledTimes(1);
    // A failed restore must NOT tear down the in-memory session (no reset/forget).
    expect(deps.reset).not.toHaveBeenCalled();
    expect(deps.forgetPersisted).not.toHaveBeenCalled();
  });

  it("KEEPS the pointer on a TRANSIENT failure (credential present) — no wipe on a blip", async () => {
    const { deps } = makeDeps({
      credentialPresence: vi.fn(async (): Promise<CredentialPresence> => "present"),
    });
    const decision: SessionRestoreDecision = { outcome: "login", reason: "restore-failed" };
    await applySilentRestoreDecision(decision, { webId: ALICE, issuer: ISSUER }, deps);
    expect(deps.pointer.clear).not.toHaveBeenCalled();
  });

  it("KEEPS the pointer on an UNKNOWN store read (never orphan a possibly-valid credential)", async () => {
    const { deps } = makeDeps({
      credentialPresence: vi.fn(async (): Promise<CredentialPresence> => "unknown"),
    });
    const decision: SessionRestoreDecision = { outcome: "login", reason: "restore-failed" };
    await applySilentRestoreDecision(decision, { webId: ALICE, issuer: ISSUER }, deps);
    expect(deps.pointer.clear).not.toHaveBeenCalled();
  });
});
