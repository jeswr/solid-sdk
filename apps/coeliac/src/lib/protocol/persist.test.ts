// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Round-trip tests for the protocol/conclusion cache converters (Phase 2B): the
 * stored record ↔ model-data mapping is lossless for the load-bearing fields, a
 * protocol keeps its identity across updates, and a malformed cached date is dropped
 * (fail-closed) rather than surfaced as a `NaN` Date.
 */
import type { ProtocolData, ToleranceConclusionData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import type { StoredProtocol } from "../cache/diary-store";
import {
  newConclusionRecord,
  newProtocolRecord,
  storedConclusionToData,
  storedProtocolToData,
  updateProtocolRecord,
} from "./persist";

const ROOT = "https://alice.example/";
const NOW = new Date("2026-07-03T09:00:00.000Z");

const protocol: ProtocolData = {
  targetTrigger: "lactose",
  phase: "baseline",
  phaseStarted: NOW,
  phasePlannedEnd: new Date(NOW.getTime() + 5 * 86_400_000),
  created: NOW,
  patient: "https://alice.example/profile/card#me",
};

describe("protocol persistence", () => {
  it("mints a stable ulid + protocols-container URL and round-trips the data", () => {
    const rec = newProtocolRecord(protocol, ROOT, NOW);
    expect(rec.kind).toBe("protocol");
    expect(rec.url).toBe(`${ROOT}health/diary/protocols/${rec.ulid}.ttl`);
    expect(rec.sync).toBe("pending");
    const data = storedProtocolToData(rec);
    expect(data.targetTrigger).toBe("lactose");
    expect(data.phase).toBe("baseline");
    expect(data.phaseStarted?.getTime()).toBe(NOW.getTime());
    expect(data.patient).toBe(protocol.patient);
    expect(data.id).toBe(`${rec.url}#it`);
  });

  it("preserves ulid/url/createdAt across an update, re-marking pending", () => {
    const rec = newProtocolRecord(protocol, ROOT, NOW);
    const advanced: ProtocolData = { ...protocol, phase: "eliminate", challengeStep: undefined };
    const later = new Date(NOW.getTime() + 3_600_000);
    const updated = updateProtocolRecord({ ...rec, sync: "synced" }, advanced, later);
    expect(updated.ulid).toBe(rec.ulid);
    expect(updated.url).toBe(rec.url);
    expect(updated.createdAt).toBe(rec.createdAt);
    expect(updated.phase).toBe("eliminate");
    expect(updated.updatedAt).toBe(later.toISOString());
    expect(updated.sync).toBe("pending"); // needs a re-PUT
  });

  it("drops an unparseable stored date (fail-closed) instead of a NaN Date", () => {
    const rec: StoredProtocol = {
      kind: "protocol",
      ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      url: `${ROOT}health/diary/protocols/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl`,
      targetTrigger: "lactose",
      phase: "observe",
      phaseStarted: "not-a-date",
      challengeStep: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      sync: "synced",
    };
    const data = storedProtocolToData(rec);
    expect(data.phaseStarted).toBeUndefined();
    expect(data.challengeStep).toBe(1);
  });
});

describe("conclusion persistence", () => {
  const conclusion: ToleranceConclusionData = {
    aboutTrigger: "lactose",
    verdict: "reacts",
    confidence: "confirmed",
    note: "Confirmed by your own challenge.",
    reviewAfter: new Date(NOW.getTime() + 182 * 86_400_000),
    derivedFrom: ["https://alice.example/health/diary/protocols/x.ttl#it"],
  };

  it("round-trips a confirmed conclusion incl. reviewAfter + derivedFrom", () => {
    const rec = newConclusionRecord(conclusion, ROOT, "PROTO_ULID", NOW);
    expect(rec.url).toBe(`${ROOT}health/diary/conclusions/${rec.ulid}.ttl`);
    expect(rec.protocolUlid).toBe("PROTO_ULID");
    expect(rec.confidence).toBe("confirmed");
    const data = storedConclusionToData(rec);
    expect(data.verdict).toBe("reacts");
    expect(data.reviewAfter?.getTime()).toBe(conclusion.reviewAfter?.getTime());
    expect(data.derivedFrom).toEqual(conclusion.derivedFrom);
    // Identity + created preserved (idempotent re-sync; stable review conclusionId).
    expect(data.id).toBe(`${rec.url}#it`);
    expect(data.created?.getTime()).toBe(NOW.getTime());
  });
});
