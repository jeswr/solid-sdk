// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { recordToTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { parseAs2Message } from "@jeswr/solid-chat-interop";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, createAgentClient } from "../src/apps/agent/lib/client";
import {
  appendOwnerTurn,
  isConversationUnread,
  newConversation,
  nextTurnNumber,
  TURN_TEXT_LIMIT,
} from "../src/apps/agent/lib/conversation";
import {
  archiveKey,
  deviceState,
  readMarkerKey,
  saveDeviceState,
  saveTabState,
  tabState,
} from "../src/apps/agent/lib/device-state";
import { structuredCards, triageLabel } from "../src/apps/agent/lib/inbox";
import { loadedRecords, readInbox, readTurns } from "../src/apps/agent/lib/readers";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const BASE = `${DEMO_ROOT}agent/`;
const conversation = `${BASE}conversations/thread/`;
const clientFor = (fetch: typeof globalThis.fetch) =>
  createAgentClient({ fetch, storage: DEMO_ROOT, workspace: BASE });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("conversation turns", () => {
  it("numbers numerically across gaps and rejects ambiguous or unsafe members", () => {
    expect(nextTurnNumber([], conversation)).toBe(0);
    expect(
      nextTurnNumber(
        [10, 2, 0, 9].map((n) => `${conversation}${n}.ttl`),
        conversation,
      ),
    ).toBe(11);
    for (const url of [
      "https://other.example/1.ttl",
      `${conversation}x.ttl`,
      `${conversation}01.ttl`,
      `${conversation}nested/1.ttl`,
      `${conversation}${Number.MAX_SAFE_INTEGER}.ttl`,
      `${conversation}99999999999999999.ttl`,
    ])
      expect(() => nextTurnNumber([url], conversation)).toThrow();
  });
  it("writes immutable agent-model turns interoperable as canonical as:Note", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const spy = vi.fn(pod.fetch);
    const client = clientFor(spy);
    expect(await newConversation(client, "thread")).toBe("thread");
    const first = await appendOwnerTurn(client, "thread", DEMO_WEBID, "Hello <b>agent</b>");
    expect(first.id).toBe(`${conversation}0.ttl`);
    const doc = await client.graph(first.id);
    expect(parseAs2Message(first.id, doc.dataset)).toMatchObject({
      content: "Hello <b>agent</b>",
      author: DEMO_WEBID,
      mediaType: "text/plain",
    });
    expect(loadedRecords(await readTurns(client, "thread"))[0]).toEqual(first);
    expect(
      spy.mock.calls.find(([url, init]) => url === first.id && init?.method === "PUT")?.[1]
        ?.headers,
    ).toMatchObject({ "if-none-match": "*" });
    const headers = spy.mock.calls.find(
      ([url, init]) => url === conversation && init?.method === "PUT",
    )?.[1]?.headers;
    expect(headers).toMatchObject({
      link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    });
    const second = await appendOwnerTurn(
      client,
      "thread",
      DEMO_WEBID,
      "Second",
      () => new Date("2026-11-01T12:00:00Z"),
    );
    expect(second.id).toBe(`${conversation}1.ttl`);
    expect(second.createdAt).toBe("2026-11-01T12:00:00.000Z");
    expect(await newConversation(client)).toMatch(/^[0-9a-f-]{36}$/);
    await expect(newConversation(client, "../bad")).rejects.toThrow();
    await expect(newConversation(client, "thread")).rejects.toBeInstanceOf(ConflictError);
  });
  it("re-lists after a 412, retaining the winning turn", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    let collide = true;
    const client = clientFor(async (url, init) => {
      if (url === `${conversation}0.ttl` && init?.method === "PUT" && collide) {
        collide = false;
        await pod.fetch(url, {
          method: "PUT",
          headers: { "content-type": "text/turtle" },
          body: await recordToTurtle({
            ...exampleRecords["conversation-turn"],
            id: String(url),
            conversation,
            text: "Other device",
          }),
        });
        return new Response(null, { status: 412 });
      }
      return pod.fetch(url, init);
    });
    const result = await appendOwnerTurn(client, "thread", DEMO_WEBID, "My message");
    expect(result.id).toBe(`${conversation}1.ttl`);
    expect(loadedRecords(await readTurns(client, "thread")).map((t) => t.text)).toContain(
      "Other device",
    );
  });
  it("bounds retries and preserves drafts on failed writes, invalid input and listing failures", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const client = clientFor(async (url, init) =>
      init?.method === "PUT" ? new Response(null, { status: 412 }) : pod.fetch(url, init),
    );
    await expect(appendOwnerTurn(client, "thread", DEMO_WEBID, "Message")).rejects.toThrow("busy");
    for (const text of [" ", "a".repeat(16385)])
      await expect(appendOwnerTurn(client, "thread", DEMO_WEBID, text)).rejects.toThrow("message");
    const forbidden = clientFor(async () => new Response(null, { status: 403 }));
    await expect(appendOwnerTurn(forbidden, "thread", DEMO_WEBID, "hello")).rejects.toThrow();
    await expect(newConversation(forbidden, "thread")).rejects.toThrow();
    const unwritable = clientFor(async (url, init) =>
      init?.method === "PUT" ? new Response(null, { status: 500 }) : pod.fetch(url, init),
    );
    await expect(appendOwnerTurn(unwritable, "thread", DEMO_WEBID, "hello")).rejects.toThrow(
      "save",
    );
  });
  it("accepts exactly 16,384 characters and rejects 16,385 before any request", async () => {
    expect(TURN_TEXT_LIMIT).toBe(16384);
    const pod = createDemoPod({ root: DEMO_ROOT });
    const fetch = vi.fn(pod.fetch);
    const client = clientFor(fetch);
    const turn = await appendOwnerTurn(client, "thread", DEMO_WEBID, "a".repeat(16384));
    expect(turn.text).toHaveLength(16384);
    expect(loadedRecords(await readTurns(client, "thread"))[0]?.text).toHaveLength(16384);
    fetch.mockClear();
    await expect(appendOwnerTurn(client, "thread", DEMO_WEBID, "a".repeat(16385))).rejects.toThrow(
      "16,384",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, 0, false],
    [{ role: "owner", createdAt: "2026-11-01T00:00:00Z" }, 0, false],
    [{ role: "agent", createdAt: "2026-11-01T00:00:00Z" }, 0, true],
    [
      { role: "agent", createdAt: "2026-11-01T00:00:00Z" },
      Date.parse("2026-11-01T00:00:00Z"),
      false,
    ],
    [{ role: "agent", createdAt: "bad" }, 0, false],
  ])("unread uses the last role and per-device timestamp: %j", (last, read, want) =>
    expect(
      isConversationUnread(last as { role: string; createdAt: string } | undefined, read as number),
    ).toBe(want));
});

describe("device state", () => {
  it("isolates read and archive preferences per owner/resource, surviving unavailable storage", () => {
    expect(deviceState("key")).toBeNull();
    expect(saveDeviceState("key", "true")).toBe(false);
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    expect(readMarkerKey("owner", "conversation")).not.toBe(readMarkerKey("other", "conversation"));
    const key = archiveKey("owner", "message");
    expect(key).not.toBe(archiveKey("owner", "other"));
    expect(saveDeviceState(key, "true")).toBe(true);
    expect(deviceState(key)).toBe("true");
    expect(deviceState("missing")).toBeNull();
  });
  it("keeps tab state, and survives blocked session storage", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(tabState("key")).toBeNull();
    expect(saveTabState("key", "12")).toBe(false);
    expect(saveTabState("key", undefined)).toBe(false);
    const data = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
    expect(saveTabState("key", "12")).toBe(true);
    expect(tabState("key")).toBe("12");
    expect(saveTabState("key", undefined)).toBe(true);
    expect(tabState("key")).toBeNull();
  });
});

describe("message parts", () => {
  it("attaches triage to its source message and keeps HTML alternatives inert", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
    const message = loadedRecords(await readInbox(clientFor(pod.fetch), "gmail")).find(
      (m) => m.subject === "Calendar invitation",
    );
    expect(message?.triage?.primary).toBe("meeting");
    expect(message?.identityStatus).toBe("unverified");
    expect(await structuredCards(message?.structuredPart ?? [])).toMatchObject([
      { kind: "calendar", title: "Project catch-up", location: "Meeting room", model: false },
    ]);
    expect(message?.structuredPart).toHaveLength(2);
  });
  it("projects calendar and JSON-LD cards with explicit model provenance", async () => {
    expect(
      await structuredCards([null, [], 1, "text", true, {}, { type: "text/html", value: "<img>" }]),
    ).toEqual([]);
    const cards = await structuredCards([
      { type: "text/calendar" },
      { type: "Event", title: "Tea", start: "start", end: "end" },
      { "@type": "https://schema.org/Event", name: "Lunch", startDate: "s", endDate: "e" },
      { "@type": "https://schema.org/Thing", name: "A thing", provenance: "model" },
      { type: "Thing", modelProvenance: {} },
      { type: "Thing", generatedBy: "urn:model" },
      { type: "Thing", "prov:wasGeneratedBy": "urn:model" },
      { type: "Thing", provenance: { type: "model" } },
      { type: "Thing", provenance: { model: "small" } },
      { type: "Thing", provenance: { generatedBy: "urn:model" } },
      { type: "Thing", provenance: {} },
      { type: "Thing", provenance: [] },
    ]);
    expect(cards.slice(0, 3)).toMatchObject([
      { kind: "calendar", title: "Calendar event", model: false },
      { title: "Tea", start: "start", end: "end" },
      { title: "Lunch", start: "s", end: "e" },
    ]);
    expect(cards.slice(3, 10).every((p) => p.model)).toBe(true);
    expect(cards[3]).toMatchObject({ kind: "jsonld", type: "Thing", title: "A thing" });
    expect(cards.slice(10).every((p) => !p.model)).toBe(true);
    expect(triageLabel("meeting")).toBe("Meeting");
    expect(triageLabel("private-code")).toBe("private-code");
    expect(triageLabel(undefined)).toBe("Not assessed");
  });
  it.each([
    { "http://www.w3.org/ns/prov#wasGeneratedBy": { "@id": "urn:model" } },
    { "@context": { p: "http://www.w3.org/ns/prov#" }, "p:wasGeneratedBy": { "@id": "urn:model" } },
    {
      "@context": { origin: "http://www.w3.org/ns/prov#wasGeneratedBy" },
      origin: { "@id": "urn:model" },
    },
    {
      "@context": [{ p: "http://www.w3.org/ns/prov#" }, { origin: "p:wasGeneratedBy" }],
      origin: { "@id": "urn:model" },
    },
    { "@context": "https://remote.example/context" },
  ])("expands provenance and never treats unreadable provenance as deterministic: %j", async (provenance) => {
    expect(await structuredCards([{ type: "Thing", ...provenance }])).toMatchObject([
      { model: true },
    ]);
  });
  it("respects a redefined prefix and keeps prototype names and markup as plain label text", async () => {
    expect(
      await structuredCards([
        {
          type: "Thing",
          "@context": { prov: "https://other.example/" },
          "prov:wasGeneratedBy": "urn:model",
        },
      ]),
    ).toMatchObject([{ model: false }]);
    for (const text of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "<img src=x onerror=alert(1)>",
    ])
      expect(triageLabel(text)).toBe(text);
  });
});
