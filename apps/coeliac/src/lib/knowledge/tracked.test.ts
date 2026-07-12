// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** Local tracked-trigger derivation (§3.2) — used ONLY for on-device re-ranking. */
import { describe, expect, it } from "vitest";
import { DiaryStore } from "../cache/diary-store";
import { MemoryKv } from "../cache/kv";
import { trackedTriggers } from "./tracked";

const WEBID = "https://alice.example/profile/card#me";

describe("trackedTriggers", () => {
  it("returns [] for no store (fail-soft)", async () => {
    expect(await trackedTriggers(null)).toEqual([]);
  });

  it("collects distinct triggers from protocols + conclusions", async () => {
    const store = new DiaryStore(new MemoryKv(), WEBID);
    await store.putProtocol({
      kind: "protocol",
      ulid: "01AAAAAAAAAAAAAAAAAAAAAAAA",
      url: `${WEBID}/p`,
      targetTrigger: "lactose",
      phase: "eliminate",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
      sync: "synced",
    });
    await store.putConclusion({
      kind: "conclusion",
      ulid: "01BBBBBBBBBBBBBBBBBBBBBBBB",
      url: `${WEBID}/c`,
      aboutTrigger: "sulphites",
      verdict: "reacts",
      confidence: "confirmed",
      createdAt: "2026-07-01T00:00:00Z",
      sync: "synced",
    });
    const triggers = await trackedTriggers(store);
    expect(new Set(triggers)).toEqual(new Set(["lactose", "sulphites"]));
  });
});
