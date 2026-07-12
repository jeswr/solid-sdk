// AUTHORED-BY Claude Sonnet 5
/**
 * The Insights safety-context cache round-trip (suite-tracker-ov8g deliverable 2):
 * the alarm-flags/coeliac-diagnosed/strict-adherence inputs persist across a
 * reload (a fresh hook instance reading the same WebID-scoped store) instead of
 * resetting to the always-safe defaults every visit.
 */
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { SessionContext } from "./context";
import { useSafetyContextCache } from "./use-safety-context";
import { makeSession } from "../../../test/session-harness";

describe("useSafetyContextCache", () => {
  it("defaults to the safe empty context before anything is saved", async () => {
    const harness = makeSession();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionContext.Provider value={harness.value}>{children}</SessionContext.Provider>
    );
    const { result } = renderHook(() => useSafetyContextCache(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.context).toEqual({});
  });

  it("persists an update and reads it back in a FRESH hook instance (same WebID scope)", async () => {
    const harness = makeSession();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionContext.Provider value={harness.value}>{children}</SessionContext.Provider>
    );

    const first = renderHook(() => useSafetyContextCache(), { wrapper });
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    await act(async () => {
      await first.result.current.update({
        coeliacDiagnosed: true,
        strictAdherence: true,
        alarmFlags: { giBleeding: true },
      });
    });
    // Optimistic — the SAME instance reflects it immediately.
    expect(first.result.current.context.coeliacDiagnosed).toBe(true);

    // A brand-new hook instance (simulating a reload) reads the persisted value
    // back from the cache — it does NOT reset to the safe defaults.
    const second = renderHook(() => useSafetyContextCache(), { wrapper });
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.context).toEqual({
      coeliacDiagnosed: true,
      strictAdherence: true,
      alarmFlags: { giBleeding: true },
    });
  });
});
