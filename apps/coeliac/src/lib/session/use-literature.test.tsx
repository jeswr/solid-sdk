// AUTHORED-BY Claude Sonnet 5
/**
 * The literature-fetch DEFAULT path is the single most privacy-sensitive seam in
 * Phase 3a (design §2.1/§3.2, `AGENTS.md` invariant 1): the external query sent to
 * Europe PMC/PubMed must be the fixed GENERIC coeliac term, NEVER anything derived
 * from the user's own logged triggers/symptoms/protocol/conclusion state — even
 * though that same state IS read locally (`trackedTriggers`) to re-rank the
 * already-fetched public results on-device. This test builds a user profile with
 * specific triggers/symptoms (a "sulphites" protocol + conclusion, a "bloating"
 * symptom noted "recent flare") and proves the outbound EPMC query string is the
 * fixed generic query and contains none of that profile data.
 *
 * It also proves the fail-open requirement: when EPMC AND the PubMed fallback are
 * BOTH unreachable, the hook settles to an error state without throwing — a
 * literature-API outage must never crash the app.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SessionContext } from "./context";
import { useLiterature } from "./use-literature";
import { trackedTriggers } from "../knowledge/tracked";
import { makeSession } from "../../../test/session-harness";

const WEBID = "https://alice.example/profile/card#me";

describe("useLiterature — default path privacy invariant", () => {
  it("sends ONLY the fixed generic query to Europe PMC — never the user's own tracked triggers/symptoms", async () => {
    const harness = makeSession({ webId: WEBID });
    const { store } = harness;
    await store.putProtocol({
      kind: "protocol",
      ulid: "01SULPHITEPROTOCOL0000000",
      url: `${WEBID}/protocols/sulphites.ttl`,
      targetTrigger: "sulphites",
      phase: "eliminate",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
      sync: "synced",
    });
    await store.putConclusion({
      kind: "conclusion",
      ulid: "01SULPHITECONCLUSION00000",
      url: `${WEBID}/conclusions/sulphites.ttl`,
      aboutTrigger: "sulphites",
      verdict: "reacts",
      confidence: "confirmed",
      createdAt: "2026-07-01T00:00:00Z",
      sync: "synced",
    });
    await store.putSymptom({
      kind: "symptom",
      ulid: "01RECENTFLARESYMPTOM00000",
      url: `${WEBID}/symptoms/flare.ttl`,
      symptomType: "bloating",
      onset: "2026-07-02T09:00:00Z",
      createdAt: "2026-07-02T09:00:00Z",
      severity: 8,
      note: "recent flare after dinner",
      sync: "synced",
    });

    const seenUrls: string[] = [];
    const publicFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      return new Response(
        JSON.stringify({ hitCount: 0, resultList: { result: [] } }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;

    const value = { ...harness.value, publicFetch };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    );

    const { result } = renderHook(() => useLiterature(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Check EVERY outbound URL (not just the ones that happen to hit EPMC) — a
    // regression that leaked the profile through a DIFFERENT knowledge request
    // (e.g. the PubMed fallback, or a future call) must fail this test too.
    expect(seenUrls.length).toBeGreaterThan(0);
    for (const called of seenUrls) {
      expect(called.toLowerCase()).not.toContain("sulphite");
      expect(called.toLowerCase()).not.toContain("bloating");
      expect(called.toLowerCase()).not.toContain("flare");
      expect(called.toLowerCase()).not.toContain("recent");
    }
    const epmcCalls = seenUrls.filter((u) => u.includes("www.ebi.ac.uk"));
    expect(epmcCalls.length).toBeGreaterThan(0);
    for (const called of epmcCalls) {
      const query = new URL(called).searchParams.get("query");
      // the fixed generic query — decoded, exactly what buildEpmcSearchUrl's default emits
      expect(query).toBe('(coeliac OR "celiac disease")');
    }
    // sanity: the profile really was read locally (for on-device re-ranking) —
    // proves this isn't a vacuous pass because trackedTriggers returned [].
    expect(await trackedTriggers(store)).toContain("sulphites");
  });

  it("falls back to PubMed with the fixed generic condition — never the user's tracked triggers — when Europe PMC fails", async () => {
    const harness = makeSession({ webId: WEBID });
    const { store } = harness;
    await store.putProtocol({
      kind: "protocol",
      ulid: "01SULPHITEPROTOCOL0000001",
      url: `${WEBID}/protocols/sulphites.ttl`,
      targetTrigger: "sulphites",
      phase: "eliminate",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
      sync: "synced",
    });

    const seenUrls: string[] = [];
    const publicFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.includes("www.ebi.ac.uk")) return new Response("down", { status: 503 });
      if (url.includes("esearch")) {
        return new Response(JSON.stringify({ esearchresult: { count: "0", idlist: [] } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const value = { ...harness.value, publicFetch };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    );

    const { result } = renderHook(() => useLiterature(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const pubmedCalls = seenUrls.filter((u) => u.includes("eutils.ncbi.nlm.nih.gov"));
    expect(pubmedCalls.length).toBeGreaterThan(0);
    const esearchCall = pubmedCalls.find((u) => u.includes("esearch"));
    expect(esearchCall).toBeDefined();
    const term = new URL(esearchCall as string).searchParams.get("term");
    // GENERIC_COELIAC_CONDITION — never "sulphites" or any user-tracked trigger
    expect(term).toBe("celiac disease");
    for (const called of seenUrls) {
      expect(called.toLowerCase()).not.toContain("sulphite");
    }
  });

  it("fails open — never throws — when Europe PMC AND the PubMed fallback are both unreachable", async () => {
    const harness = makeSession({ webId: WEBID });
    const publicFetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const value = { ...harness.value, publicFetch };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    );

    const { result } = renderHook(() => useLiterature(), { wrapper });
    // must settle (not hang, not throw) even though every upstream call rejects
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ranked).toEqual([]);
    expect(result.current.error).toBeTruthy();

    // refresh() must also not throw when called directly
    await act(async () => {
      await expect(result.current.refresh()).resolves.toBeUndefined();
    });
  });
});
