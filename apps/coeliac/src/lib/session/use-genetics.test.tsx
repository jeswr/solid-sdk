// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Direct hook-level tests for the fail-closed consent guardrail and the on-device
 * parse boundary — the belt-and-braces layer under the view's disabled-Save button.
 */
import { render } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { DiaryStore } from "@/lib/cache/diary-store";
import { MemoryKv } from "@/lib/cache/kv";
import { resetDiaryReadyMemo } from "@/lib/pod/pod-fs";
import { anonymousSession, SessionContext, type SessionValue } from "@/lib/session/context";
import {
  ConsentRequiredError,
  type GeneticsActions,
  type GeneticsState,
  useGenetics,
} from "@/lib/session/use-genetics";
import { makeFetchMock } from "../../../test/session-harness";

/** Mount the hook and expose its live value + the recording fetch mock. */
function mountHook() {
  resetDiaryReadyMemo();
  const fetchMock = makeFetchMock();
  const store = new DiaryStore(new MemoryKv(), "https://alice.example/profile/card#me");
  const value: SessionValue = {
    ...anonymousSession,
    status: "authed",
    webId: "https://alice.example/profile/card#me",
    storageRoot: "https://alice.example/",
    store,
    authedFetch: fetchMock.fetch,
    publicFetch: fetchMock.fetch,
  };
  const ref: { current?: GeneticsState & GeneticsActions } = {};
  function Probe() {
    ref.current = useGenetics();
    return null;
  }
  render(
    <SessionContext.Provider value={value}>
      <Probe />
    </SessionContext.Provider>,
  );
  return { ref, fetchMock, store };
}

describe("useGenetics — fail-closed consent", () => {
  it("save(preview, false) REJECTS with ConsentRequiredError and writes NOTHING", async () => {
    const { ref, fetchMock, store } = mountHook();
    const preview = ref.current!.buildManualPreview({ "DQ2.5": "present" });
    await act(async () => {
      await expect(ref.current!.save(preview, false)).rejects.toBeInstanceOf(ConsentRequiredError);
    });
    // Nothing was cached and NO request was ever issued for the un-consented save.
    expect(await store.getGeneticSummary()).toBeUndefined();
    expect(fetchMock.puts()).toHaveLength(0);
  });

  it("save(preview, true) DOES persist (the positive control)", async () => {
    const { ref, store } = mountHook();
    const preview = ref.current!.buildManualPreview({ "DQ2.5": "present" });
    await act(async () => {
      const { syncing } = await ref.current!.save(preview, true);
      await syncing;
    });
    const saved = await store.getGeneticSummary();
    expect(saved?.consentGiven).toBe(true);
    expect(saved?.sync).toBe("synced");
  });
});
