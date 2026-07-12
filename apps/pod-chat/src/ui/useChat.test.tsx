// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Focused tests for the chat hook's race + lifecycle handling that the
// component test can't deterministically force: a slow room-list load
// superseded by a newer pod input must NOT overwrite the newer state; a late
// rejection must not surface an error; a pod-input change resets the open room
// + every loading flag; an open room that vanishes resolves to the list; and a
// 401/403 read is classified as an access error. The pure comparator
// (`chronological`) and error classifier (`describeError`) are exercised
// directly for every branch.

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomsAccessError } from "./rooms.js";
import { chronological, describeError, type MessageView, useChat } from "./useChat.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const POD = "https://pod.example/";
const WEBID = "https://pod.example/profile/card#me";
const ROOMS = "https://pod.example/pod-chat/rooms/";
const MESSAGES = "https://pod.example/pod-chat/messages/";
const ROOM_A = `${ROOMS}general-aaa.ttl`;
const MSG_1 = `${MESSAGES}msg-1.ttl`;
const MSG_2 = `${MESSAGES}msg-2.ttl`;

/** An LDP container listing of the given member resource URLs. */
function containerTtl(container: string, members: string[]): string {
  const contains = members.map((m) => `<${m}>`).join(", ");
  return `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${container}> a ldp:Container, ldp:BasicContainer${
    members.length > 0 ? ` ;\n  ldp:contains ${contains}` : ""
  } .
${members.map((m) => `<${m}> a ldp:Resource .`).join("\n")}
`;
}

/** A room descriptor resource (subject `<url>#it`) with the given message refs. */
function roomTtl(url: string, name: string, refs: string[]): string {
  const items = refs.map((r) => `<${r}>`).join(", ");
  return `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix pc: <https://w3id.org/jeswr/pod-chat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${url}#it> a as:Collection, pc:ChatRoom ;
  as:name "${name}" ;
  dct:creator <${WEBID}> ;
  dct:created "2026-06-10T09:00:00Z"^^xsd:dateTime${
    refs.length > 0 ? ` ;\n  as:items ${items}` : ""
  } .
`;
}

/** A message resource (subject `<url>#it`). */
function messageTtl(url: string, content: string, publishedIso: string): string {
  return `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${url}#it> a as:Note ;
  as:content "${content}" ;
  as:mediaType "text/plain" ;
  as:attributedTo <${WEBID}> ;
  as:published "${publishedIso}"^^xsd:dateTime .
`;
}

/** A 200 Turtle Response. */
function ttl(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
}

/**
 * A fetch that routes by URL across a one-room pod: the rooms container lists
 * ROOM_A; ROOM_A indexes MSG_1 + MSG_2; the messages container is empty.
 */
function podFetch(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
    if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", [MSG_2, MSG_1]));
    if (url === MSG_1) return ttl(messageTtl(MSG_1, "first", "2026-06-10T10:00:00Z"));
    if (url === MSG_2) return ttl(messageTtl(MSG_2, "second", "2026-06-10T11:00:00Z"));
    if (url === MESSAGES) return ttl(containerTtl(MESSAGES, []));
    return new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

describe("describeError", () => {
  it("classifies a 401 as a login-flavoured access error", () => {
    const { isAccess, message } = describeError(new RdfFetchError("nope", { status: 401 }));
    expect(isAccess).toBe(true);
    expect(message).toContain("log in");
  });
  it("classifies a 403 as a permission access error", () => {
    const { isAccess, message } = describeError(new RdfFetchError("nope", { status: 403 }));
    expect(isAccess).toBe(true);
    expect(message).toContain("permission");
  });
  it("classifies a 404 / network / non-RdfFetchError generically", () => {
    expect(describeError(new RdfFetchError("missing", { status: 404 })).isAccess).toBe(false);
    expect(describeError(new TypeError("network down")).isAccess).toBe(false);
    expect(describeError("plain").message).toBe("plain");
  });
  it("classifies a RoomsAccessError (facade 401/403) as an access error", () => {
    const a401 = describeError(new RoomsAccessError(401, ROOMS, null));
    expect(a401.isAccess).toBe(true);
    expect(a401.message).toContain("log in");
    const a403 = describeError(new RoomsAccessError(403, ROOMS, null));
    expect(a403.isAccess).toBe(true);
    expect(a403.message).toContain("permission");
  });
});

describe("chronological", () => {
  it("sorts dated messages oldest-first and undated ones last (every branch)", () => {
    const mk = (url: string, iso?: string): MessageView => ({
      url,
      content: url,
      author: undefined,
      published: iso !== undefined ? new Date(iso) : undefined,
      task: undefined,
    });
    const sorted = chronological([
      mk("u1"),
      mk("d2", "2026-06-10T11:00:00Z"),
      mk("d1", "2026-06-10T09:00:00Z"),
      mk("u2"),
    ]);
    expect(sorted.map((m) => m.url).slice(0, 2)).toEqual(["d1", "d2"]);
    expect(
      sorted
        .map((m) => m.url)
        .slice(2)
        .sort(),
    ).toEqual(["u1", "u2"]);
    // Does not mutate the input.
    expect(chronological([]).length).toBe(0);
  });
});

describe("useChat", () => {
  it("loads the room list on mount", async () => {
    const fetch = podFetch();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.roomsError).toBeNull();
    expect(result.current.rooms).toHaveLength(1);
    expect(result.current.rooms[0]?.name).toBe("General");
    expect(result.current.rooms[0]?.messageCount).toBe(2);
  });

  it("labels a nameless room by its URL-derived fallback and sorts by label", async () => {
    // ROOM_A has a name ("General"); a second room carries NO as:name, so its
    // list label + sort key come from the URL fallback — exercising both
    // branches of the internal label helper.
    const RoomNameless = `${ROOMS}aaa-first.ttl`;
    const namelessTtl = `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix pc: <https://w3id.org/jeswr/pod-chat#> .
<${RoomNameless}#it> a as:Collection, pc:ChatRoom .
`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A, RoomNameless]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      if (url === RoomNameless) return ttl(namelessTtl);
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.rooms).toHaveLength(2);
    // Sorted by label: "aaa-first.ttl" (the URL fallback) before "General".
    expect(result.current.rooms[0]?.name).toBeUndefined();
    expect(result.current.rooms[0]?.fallbackName).toBe("aaa-first.ttl");
    expect(result.current.rooms[1]?.name).toBe("General");
  });

  it("opens a room and loads its thread chronologically, then returns via back", async () => {
    const fetch = podFetch();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(result.current.openRoom?.name).toBe("General");
    act(() => result.current.back());
    expect(result.current.openRoomUrl).toBeNull();
    expect(result.current.messages).toHaveLength(0);
  });

  it("does not let a slow superseded room-list load overwrite a newer pod", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://slow.example/pod-chat/rooms/") {
        await slow;
        return ttl(containerTtl("https://slow.example/pod-chat/rooms/", []));
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useChat(pod, WEBID, { fetch }),
      { initialProps: { pod: "https://slow.example/" } },
    );
    rerender({ pod: POD });
    await waitFor(() => expect(result.current.rooms.map((r) => r.name)).toContain("General"));

    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    // The stale empty SLOW pod did NOT wipe the fast pod's room.
    expect(result.current.rooms).toHaveLength(1);
  });

  it("discards a superseded room-list load that REJECTS after a newer pod", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://slow.example/pod-chat/rooms/") {
        await slow;
        throw new TypeError("slow load failed late");
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useChat(pod, WEBID, { fetch }),
      { initialProps: { pod: "https://slow.example/" } },
    );
    rerender({ pod: POD });
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));

    await act(async () => {
      releaseSlow();
      await slow.catch(() => {});
    });
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.roomsError).toBeNull();
  });

  it("resets the open room AND every loading flag when the pod input changes", async () => {
    const fetch = podFetch();
    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useChat(pod, WEBID, { fetch }),
      { initialProps: { pod: POD } },
    );
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.openRoomUrl).toBe(ROOM_A);

    rerender({ pod: "https://other.example/" });
    // The reset is applied during render: open room cleared immediately.
    expect(result.current.openRoomUrl).toBeNull();
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.loadingMessages).toBe(false);
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
  });

  it("does NOT reset when the pod input is unchanged across a re-render", async () => {
    const fetch = podFetch();
    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useChat(pod, WEBID, { fetch }),
      { initialProps: { pod: POD } },
    );
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    rerender({ pod: POD });
    expect(result.current.openRoomUrl).toBe(ROOM_A);
  });

  it("resets cleanly under StrictMode's double render of a pod change", async () => {
    const fetch = podFetch();
    const { result, rerender } = renderHook(
      ({ pod }: { pod: string }) => useChat(pod, WEBID, { fetch }),
      { initialProps: { pod: POD }, wrapper: StrictMode },
    );
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    rerender({ pod: "https://other.example/" });
    expect(result.current.openRoomUrl).toBeNull();
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
  });

  it("surfaces a 401 read as a room-list access error (no retry semantics)", async () => {
    const fetch = (async () =>
      new Response(null, { status: 401 })) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.roomsError).not.toBeNull());
    expect(result.current.roomsAccessError).toBe(true);
  });

  it("surfaces a 403 on the rooms CONTAINER as access-denied, NOT an empty 'No rooms'", async () => {
    // Regression guard: the data layer's listContainer swallows a 403 on the
    // container to [] (a misleading "No rooms." for a reader without access).
    // The hook lists via the facade, so a forbidden rooms container surfaces the
    // access-denied state instead — and the list stays empty (no false rows).
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return new Response("forbidden", { status: 403 });
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.roomsAccessError).toBe(true);
    expect(result.current.roomsError).toContain("permission");
    expect(result.current.rooms).toHaveLength(0); // access-denied, NOT a populated list
  });

  it("clears a previously-loaded room list (and the open room) when a reload 403s", async () => {
    // Regression guard for the access-error STALE-DATA bug: a first load
    // succeeds and a room is opened; then the user loses permission (or the
    // pod becomes unreadable) and the next room-list load 403s. The hook must
    // surface the access-denied state with NO stale rooms still rendered
    // beneath it — `rooms` empty AND the open room cleared — not the previously
    // loaded list alongside an access error.
    let denied = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) {
        return denied
          ? new Response("forbidden", { status: 403 })
          : ttl(containerTtl(ROOMS, [ROOM_A]));
      }
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    // First load succeeded: the room is listed and opened.
    expect(result.current.rooms).toHaveLength(1);
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.openRoom).not.toBeNull());
    expect(result.current.openRoomUrl).toBe(ROOM_A);

    // Permission is now lost; a reload of the room list 403s.
    denied = true;
    act(() => result.current.refreshRooms());
    await waitFor(() => expect(result.current.roomsAccessError).toBe(true));
    expect(result.current.roomsError).toContain("permission");
    // The stale list and the stale selection are BOTH cleared — the
    // access-denied state shows with no leftover rooms or open room.
    expect(result.current.rooms).toHaveLength(0);
    expect(result.current.openRoomUrl).toBeNull();
    expect(result.current.openRoom).toBeNull();
  });

  it("treats a 404 rooms container as an empty list, not an access error", async () => {
    // A not-yet-created rooms container is the new-pod case: empty, not denied.
    const fetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.rooms).toHaveLength(0);
    expect(result.current.roomsError).toBeNull();
    expect(result.current.roomsAccessError).toBe(false);
  });

  it("treats an empty 2xx rooms container as an empty list, not an access error", async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.rooms).toHaveLength(0);
    expect(result.current.roomsError).toBeNull();
    expect(result.current.roomsAccessError).toBe(false);
  });

  it("surfaces a generic thread error when the open room read 404s", async () => {
    // Rooms container lists ROOM_A, but reading ROOM_A as the thread 404s.
    let roomGone = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) {
        if (roomGone) return new Response(null, { status: 404 });
        return ttl(roomTtl(ROOM_A, "General", []));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    roomGone = true;
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.messagesError).not.toBeNull());
    // A 404 is a generic (non-access) error.
    expect(result.current.messagesAccessError).toBe(false);
  });

  it("shows an empty thread when the open room exists but is no longer a ChatRoom", async () => {
    // The thread read returns a resource that holds no pc:ChatRoom → readRoom
    // resolves undefined (not a reject) → an empty thread, not an error. The
    // list reads a real room (so there is a button); flipping `notRoom` makes
    // the subsequent thread read serve a note-shaped, non-room body.
    let notRoom = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) {
        return notRoom
          ? ttl(`<${ROOM_A}#it> <http://example.org/p> "x" .`)
          : ttl(roomTtl(ROOM_A, "General", []));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    notRoom = true;
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.messagesError).toBeNull();
  });

  it("drops a listed resource that is not a ChatRoom (readRoomView → undefined)", async () => {
    // The container lists ROOM_A (a real room) and a sibling that parses but is
    // NOT a pc:ChatRoom — the non-room resolves undefined and is filtered out.
    const NotARoom = `${ROOMS}stray.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A, NotARoom]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      if (url === NotARoom) return ttl(`<${NotARoom}#it> <http://example.org/p> "x" .`);
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.rooms.map((r) => r.name)).toEqual(["General"]);
  });

  it("skips a dangling message ref that is not an as:Note (readMessageView → undefined)", async () => {
    // The room indexes MSG_1 (a real note) + a dangling ref that parses but is
    // NOT an as:Note — the non-note resolves undefined and is filtered out.
    const Dangling = `${MESSAGES}dangling.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", [MSG_1, Dangling]));
      if (url === MSG_1) return ttl(messageTtl(MSG_1, "first", "2026-06-10T10:00:00Z"));
      if (url === Dangling) return ttl(`<${Dangling}#it> <http://example.org/p> "x" .`);
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.messages.map((m) => m.content)).toEqual(["first"]);
  });

  it("does not let a slow superseded thread load overwrite a newer room (stale resolve)", async () => {
    // Opening ROOM_A starts a thread load whose message read HANGS; switching to
    // RoomB (a distinct room + message) supersedes it and resolves fast. When
    // ROOM_A's slow read finally resolves it must be discarded as stale. Keying
    // the slow gate by message URL (not call order) makes this deterministic.
    const RoomB = `${ROOMS}team-bbb.ttl`;
    const SlowMsg = `${MESSAGES}slow.ttl`;
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A, RoomB]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", [SlowMsg]));
      if (url === RoomB) return ttl(roomTtl(RoomB, "Team", [MSG_1]));
      if (url === SlowMsg) {
        await slow;
        return ttl(messageTtl(SlowMsg, "STALE", "2026-06-10T10:00:00Z"));
      }
      if (url === MSG_1) return ttl(messageTtl(MSG_1, "fresh", "2026-06-10T11:00:00Z"));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    // Flush microtasks so ROOM_A's room read resolves and we are INSIDE the
    // message Promise.all (the slow read), then switch — so supersession lands
    // on the post-message staleness guard, not the earlier post-room one.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.open(RoomB));
    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toContain("fresh"));

    await act(async () => {
      releaseSlow();
      await slow;
    });
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.messages.map((m) => m.content)).not.toContain("STALE");
  });

  it("discards a superseded thread load that REJECTS after a newer room (stale reject)", async () => {
    const RoomB = `${ROOMS}team-bbb.ttl`;
    const SlowMsg = `${MESSAGES}slow.ttl`;
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A, RoomB]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", [SlowMsg]));
      if (url === RoomB) return ttl(roomTtl(RoomB, "Team", [MSG_1]));
      if (url === SlowMsg) {
        await slow;
        throw new TypeError("slow thread read failed late");
      }
      if (url === MSG_1) return ttl(messageTtl(MSG_1, "fresh", "2026-06-10T11:00:00Z"));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => result.current.open(RoomB));
    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toContain("fresh"));

    await act(async () => {
      releaseSlow();
      await slow.catch(() => {});
    });
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    // The late rejection of the stale thread load did NOT set a thread error.
    expect(result.current.messagesError).toBeNull();
  });

  it("resolves the open room to null when its url leaves the list (openRoom ?? null)", async () => {
    // Open ROOM_A, then refresh the room list to an empty container while the
    // room stays open — openRoom resolves null (the `?? null` fallback).
    let listed = true;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, listed ? [ROOM_A] : []));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.openRoom).not.toBeNull());
    listed = false;
    act(() => result.current.refreshRooms());
    await waitFor(() => expect(result.current.rooms).toHaveLength(0));
    // The url is still open, but it is no longer in the list → resolves null.
    expect(result.current.openRoomUrl).toBe(ROOM_A);
    expect(result.current.openRoom).toBeNull();
  });

  it("clears the thread + its loading flag when the open room is closed (back)", async () => {
    // Opening then backing out runs the messages effect's `openRoomUrl === null`
    // early-return branch (no thread to load).
    const fetch = podFetch();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(0));
    act(() => result.current.back());
    expect(result.current.openRoomUrl).toBeNull();
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.loadingMessages).toBe(false);
    expect(result.current.messagesError).toBeNull();
  });

  it("drops a single unreadable (404) room from the list but keeps the readable ones", async () => {
    const RoomB = `${ROOMS}team-bbb.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A, RoomB]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      if (url === RoomB) return new Response(null, { status: 404 }); // a broken row
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.roomsError).toBeNull();
    expect(result.current.rooms.map((r) => r.name)).toEqual(["General"]);
  });

  it("re-throws an access error from a per-room read as a list-level access error", async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return new Response(null, { status: 403 }); // forbidden room
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.roomsError).not.toBeNull());
    expect(result.current.roomsAccessError).toBe(true);
  });

  it("refreshes the room list on demand", async () => {
    let count = 0;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) {
        count += 1;
        return ttl(containerTtl(ROOMS, count > 1 ? [ROOM_A] : []));
      }
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.rooms).toHaveLength(0);
    act(() => result.current.refreshRooms());
    await waitFor(() => expect(result.current.rooms).toHaveLength(1));
  });

  it("refreshes the open room's thread on demand", async () => {
    let extra = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) {
        return ttl(roomTtl(ROOM_A, "General", extra ? [MSG_1, MSG_2] : [MSG_1]));
      }
      if (url === MSG_1) return ttl(messageTtl(MSG_1, "first", "2026-06-10T10:00:00Z"));
      if (url === MSG_2) return ttl(messageTtl(MSG_2, "second", "2026-06-10T11:00:00Z"));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    extra = true;
    act(() => result.current.refreshMessages());
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
  });

  it("falls back to globalThis.fetch when no fetch is given (room list AND thread)", async () => {
    vi.stubGlobal("fetch", vi.fn(podFetch()));
    const { result } = renderHook(() => useChat(POD, WEBID));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    expect(result.current.rooms).toHaveLength(1);
    // Open a room too, so the message-thread effect's no-fetch store branch runs.
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.messages).toHaveLength(2);
  });
});

// A 2xx Turtle write/create Response carrying a fresh ETag.
function written(etag = '"w1"'): Response {
  return new Response(null, { status: 201, headers: { etag } });
}

/**
 * A stateful one-room pod that accepts WRITES. The rooms container lists ROOM_A;
 * ROOM_A starts empty; container PUTs (ensureContainers) answer 412 ("already
 * exists"); a message PUT under MESSAGES is recorded and the room's `as:items`
 * is grown by the room PUT so a re-read of the room reflects the new message.
 *
 * `failWrite` (when set) makes the FIRST message-resource PUT fail with that
 * status — the write-failure / access-error paths. Reads always succeed.
 */
function writablePod(opts: { failWrite?: number; seed?: string[] } = {}): {
  fetch: typeof globalThis.fetch;
  posted: () => string[];
} {
  // `seed` are pre-existing message refs already in the room (so a send appends
  // to a NON-empty thread); only `posted()`-tracked refs are new writes.
  const seed = opts.seed ?? [];
  const refs: string[] = [...seed];
  const posted: string[] = [];
  let postedUrl: string | null = null;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "PUT") {
      // ensureContainers PUTs the three containers (If-None-Match: *) → 412.
      if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
        return new Response(null, { status: 412 });
      }
      // A message-resource create under the messages container.
      if (url.startsWith(MESSAGES)) {
        if (opts.failWrite !== undefined) {
          return new Response(null, { status: opts.failWrite });
        }
        postedUrl = url;
        refs.push(url);
        posted.push(url);
        return written();
      }
      // The room descriptor PUT (saveRoom appending the new ref).
      if (url === ROOM_A) return written('"r2"');
      return new Response(null, { status: 404 });
    }

    // GETs.
    if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
    if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", refs));
    if (seed.includes(url)) return ttl(messageTtl(url, "seeded", "2026-06-11T09:00:00Z"));
    if (postedUrl !== null && url === postedUrl) {
      return ttl(messageTtl(postedUrl, "hello world", "2026-06-12T12:00:00Z"));
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, posted: () => posted };
}

describe("useChat send (optimistic mutation)", () => {
  it("appends the message optimistically, persists, and settles to Saved", async () => {
    const pod = writablePod();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    expect(result.current.messages).toHaveLength(0);

    let sendResult: boolean | undefined;
    await act(async () => {
      sendResult = await result.current.send("hello world");
    });

    expect(sendResult).toBe(true);
    expect(result.current.sendStatus).toBe("saved");
    expect(result.current.sendError).toBeNull();
    // The message is present, no longer pending, with the author = session WebID.
    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0];
    expect(msg?.content).toBe("hello world");
    expect(msg?.author).toBe(WEBID);
    expect(msg?.pending).toBe(false);
    // It was persisted under the messages container and its ref appended.
    expect(pod.posted()).toHaveLength(1);
    expect(pod.posted()[0]?.startsWith(MESSAGES)).toBe(true);
  });

  it("keeps existing messages when appending a new one (the swap's `: m` branch)", async () => {
    // The room already holds MSG_1; sending appends a second message. The
    // optimistic-swap map must KEEP the existing message (the non-matching `: m`
    // arm) while only the optimistic row is replaced.
    const pod = writablePod({ seed: [MSG_1] });
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]?.content).toBe("seeded");

    await act(async () => {
      await result.current.send("the new one");
    });
    expect(result.current.sendStatus).toBe("saved");
    // BOTH messages present: the pre-existing seeded one + the new one.
    const contents = result.current.messages.map((m) => m.content);
    expect(contents).toContain("seeded");
    expect(contents).toContain("the new one");
    expect(result.current.messages).toHaveLength(2);
  });

  it("posts via the global fetch when no fetch is injected (production path)", async () => {
    const pod = writablePod();
    vi.stubGlobal("fetch", vi.fn(pod.fetch));
    const { result } = renderHook(() => useChat(POD, WEBID));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let r: boolean | undefined;
    await act(async () => {
      r = await result.current.send("via global fetch");
    });
    expect(r).toBe(true);
    expect(result.current.sendStatus).toBe("saved");
    expect(result.current.messages.map((m) => m.content)).toContain("via global fetch");
    expect(pod.posted()).toHaveLength(1);
  });

  it("shows the optimistic (pending) message WHILE the write is in flight", async () => {
    // Gate the message-resource PUT so we can observe the pending state.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = writablePod();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && url.startsWith(MESSAGES) && url !== MESSAGES) {
        await gate;
      }
      return base.fetch(input, init);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let sending: Promise<boolean>;
    act(() => {
      sending = result.current.send("in flight");
    });
    // The optimistic message is present + pending, status is "saving".
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]?.pending).toBe(true);
    expect(result.current.sendStatus).toBe("saving");

    await act(async () => {
      release();
      await sending;
    });
    expect(result.current.sendStatus).toBe("saved");
    expect(result.current.messages[0]?.pending).toBe(false);
  });

  it("single-flights overlapping sends — a 2nd send while the 1st is in flight is a no-op (no orphan pending row)", async () => {
    // The roborev Medium: a 2nd send() started while the 1st write is in flight
    // used to add a SECOND optimistic row AND bump the request id, so when the
    // 1st write resolved it took the superseded early-return and never reconciled
    // its own optimistic row — leaving a permanent "Saving…" message stuck in the
    // thread. The synchronous single-flight latch makes the 2nd call a no-op:
    // exactly one optimistic row exists, and the 1st send completes + confirms it.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = writablePod();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && url.startsWith(MESSAGES) && url !== MESSAGES) {
        await gate;
      }
      return base.fetch(input, init);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    // Fire send #1 (its message PUT blocks on the gate), then send #2 RAPIDLY
    // while #1 is still saving — both in the SAME synchronous act() so #2 races
    // #1 before any state update has propagated.
    let first: Promise<boolean>;
    let secondResult: boolean | undefined;
    act(() => {
      first = result.current.send("first");
      // The 2nd call returns synchronously-resolved false (the latch is set), so
      // it never adds a second optimistic row.
      void result.current.send("second (should be a no-op)").then((r) => {
        secondResult = r;
      });
    });

    // Exactly ONE optimistic (pending) row is shown — the 2nd send added nothing.
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]?.pending).toBe(true);
    expect(result.current.messages[0]?.content).toBe("first");
    expect(result.current.sendStatus).toBe("saving");

    // Release the gate so send #1 completes; it must confirm its own row.
    let firstResult: boolean | undefined;
    await act(async () => {
      release();
      firstResult = await first;
    });

    // The 2nd send was rejected as a no-op; the 1st settled to Saved with NO
    // orphan pending row left behind.
    expect(secondResult).toBe(false);
    expect(firstResult).toBe(true);
    expect(result.current.sendStatus).toBe("saved");
    expect(result.current.sendError).toBeNull();
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.content).toBe("first");
    expect(result.current.messages[0]?.pending).toBe(false);
    // No row is ever left pending — the orphan-"Saving…" bug cannot recur.
    expect(result.current.messages.some((m) => m.pending)).toBe(false);
    // Only ONE message was actually persisted (the 2nd never wrote).
    expect(base.posted()).toHaveLength(1);
  });

  it("does NOT block a send in a DIFFERENT room while a send in the first room is in flight (per-room latch)", async () => {
    // The roborev Medium (per-room scoping): the single-flight latch must be
    // SCOPED to the room. With a GLOBAL boolean latch, a send to room A still in
    // flight wedged the composer of room B — after switching to B the room-change
    // effect reset sendStatus to "idle" (composer LOOKS enabled) but send() in B
    // silently returned false because the global latch was still held by A's
    // send. The user types, hits Send, and nothing happens. Keying the latch by
    // room URL fixes it: B's send is blocked only by an in-flight send TO B.
    const RoomB = `${ROOMS}team-bbb.ttl`;
    // Per-room appended message refs.
    const refs: Record<string, string[]> = { [ROOM_A]: [], [RoomB]: [] };
    const posted: string[] = [];
    // Gate ONLY the first message-resource PUT (room A's) so A's send stays in
    // flight while we switch to B and send there; B's PUT runs to completion. The
    // message URL the store mints is opaque, so we gate by call order, not URL.
    let gatedFirst = false;
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "PUT") {
        // ensureContainers PUTs the three containers (If-None-Match: *) → 412.
        if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
          return new Response(null, { status: 412 });
        }
        // A message-resource create under the messages container.
        if (url.startsWith(MESSAGES)) {
          if (!gatedFirst) {
            // The FIRST message PUT is room A's — hang it on the gate.
            gatedFirst = true;
            await gateA;
          }
          posted.push(url);
          return written();
        }
        // The room descriptor PUTs (saveRoom appending the latest posted ref to
        // the room being written). Both rooms accept the append.
        if (url === ROOM_A || url === RoomB) {
          const last = posted.at(-1);
          if (last !== undefined) refs[url]?.push(last);
          return written('"r2"');
        }
        return new Response(null, { status: 404 });
      }

      // GETs.
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A, RoomB]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", refs[ROOM_A] ?? []));
      if (url === RoomB) return ttl(roomTtl(RoomB, "Team", refs[RoomB] ?? []));
      if (posted.includes(url)) {
        return ttl(messageTtl(url, "from room B", "2026-06-12T13:00:00Z"));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    // Fire send in room A — its message PUT blocks on the gate, so A's send is
    // still in flight (the per-room latch holds ROOM_A).
    let sendingA: Promise<boolean>;
    act(() => {
      sendingA = result.current.send("from room A");
    });
    await waitFor(() => expect(result.current.sendStatus).toBe("saving"));

    // Switch to room B WHILE A's send is in flight. The room-change effect resets
    // sendStatus to "idle" (composer looks enabled).
    act(() => result.current.open(RoomB));
    await waitFor(() => expect(result.current.openRoomUrl).toBe(RoomB));
    await waitFor(() => expect(result.current.sendStatus).toBe("idle"));

    // Send in room B — with the GLOBAL boolean latch this silently returned false
    // (latch still held by A) and nothing happened; with the PER-ROOM latch it
    // SUCCEEDS, because room B is not the in-flight room.
    let resultB: boolean | undefined;
    await act(async () => {
      resultB = await result.current.send("from room B");
    });
    expect(resultB).toBe(true);
    expect(result.current.sendStatus).toBe("saved");
    // B's message is present + persisted (a confirmed, non-pending row).
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.pending).toBe(false);
    expect(refs[RoomB]).toHaveLength(1);

    // Now release room A's gated send; it must settle without error (its own
    // staleness guard discards the now-stale thread mutation), leaving B intact.
    await act(async () => {
      releaseA();
      await sendingA.catch(() => {});
    });
    // Still showing room B's thread; A's send did not corrupt it, no orphan row.
    expect(result.current.openRoomUrl).toBe(RoomB);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages.some((m) => m.pending)).toBe(false);
  });

  it("releases the single-flight latch after a settled send — a subsequent send proceeds normally", async () => {
    // The latch must be cleared in the finally so the NEXT (non-overlapping) send
    // is not wrongly blocked. Send once, await it, then send again sequentially.
    const pod = writablePod();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let r1: boolean | undefined;
    await act(async () => {
      r1 = await result.current.send("one");
    });
    expect(r1).toBe(true);

    let r2: boolean | undefined;
    await act(async () => {
      r2 = await result.current.send("two");
    });
    expect(r2).toBe(true);
    expect(result.current.sendStatus).toBe("saved");
    expect(pod.posted()).toHaveLength(2);
    expect(result.current.messages.some((m) => m.pending)).toBe(false);
  });

  it("REVERTS the optimistic message and surfaces an error when the write fails", async () => {
    const pod = writablePod({ failWrite: 500 });
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let sendResult: boolean | undefined;
    await act(async () => {
      sendResult = await result.current.send("doomed");
    });

    expect(sendResult).toBe(false);
    expect(result.current.sendStatus).toBe("failed");
    expect(result.current.sendError).not.toBeNull();
    expect(result.current.sendAccessError).toBe(false);
    // The optimistic message was pulled back out — the thread is empty again.
    expect(result.current.messages).toHaveLength(0);
  });

  it("classifies a 403 write as an access error (and still reverts)", async () => {
    const pod = writablePod({ failWrite: 403 });
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    await act(async () => {
      await result.current.send("no permission");
    });
    expect(result.current.sendStatus).toBe("failed");
    expect(result.current.sendAccessError).toBe(true);
    expect(result.current.sendError).toContain("permission");
    expect(result.current.messages).toHaveLength(0);
  });

  it("classifies a 401 write as a login-flavoured access error", async () => {
    const pod = writablePod({ failWrite: 401 });
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    await act(async () => {
      await result.current.send("logged out");
    });
    expect(result.current.sendStatus).toBe("failed");
    expect(result.current.sendAccessError).toBe(true);
    expect(result.current.sendError).toContain("log in");
  });

  it("is a no-op for an empty / whitespace-only body (no write, no status change)", async () => {
    const pod = writablePod();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let r1: boolean | undefined;
    let r2: boolean | undefined;
    await act(async () => {
      r1 = await result.current.send("");
      r2 = await result.current.send("   \n\t ");
    });
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(result.current.sendStatus).toBe("idle");
    expect(result.current.messages).toHaveLength(0);
    expect(pod.posted()).toHaveLength(0);
  });

  it("is a no-op when no room is open", async () => {
    const pod = writablePod();
    const { result } = renderHook(() => useChat(POD, WEBID, { fetch: pod.fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    // No open room.
    let r: boolean | undefined;
    await act(async () => {
      r = await result.current.send("nowhere");
    });
    expect(r).toBe(false);
    expect(result.current.sendStatus).toBe("idle");
    expect(pod.posted()).toHaveLength(0);
  });

  it("surfaces a write error when the room vanished between post and append", async () => {
    // The message resource is created, but the room read for the append 404s
    // (deleted concurrently) → the send fails and reverts.
    let roomGone = false;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
          return new Response(null, { status: 412 });
        }
        if (url.startsWith(MESSAGES)) return written();
        return new Response(null, { status: 404 });
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      // The room read for the LIST succeeds; the append's re-read 404s.
      if (url === ROOM_A) {
        return roomGone ? new Response(null, { status: 404 }) : ttl(roomTtl(ROOM_A, "General", []));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    roomGone = true;

    let r: boolean | undefined;
    await act(async () => {
      r = await result.current.send("orphan");
    });
    expect(r).toBe(false);
    expect(result.current.sendStatus).toBe("failed");
    expect(result.current.messages).toHaveLength(0);
  });

  it("fails the send when the room is no longer a ChatRoom at append time (readRoom undefined)", async () => {
    // The message PUT succeeds, but the append's re-read of the room returns a
    // 200 body that no longer parses to a pc:ChatRoom → readRoom resolves
    // undefined → the send throws + reverts (the `room === undefined` guard).
    let notRoom = false;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
          return new Response(null, { status: 412 });
        }
        if (url.startsWith(MESSAGES)) return written();
        return new Response(null, { status: 404 });
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) {
        // After the send starts, the room body is a valid 200 that is NOT a room.
        return notRoom
          ? ttl(`<${ROOM_A}#it> <http://example.org/p> "x" .`)
          : ttl(roomTtl(ROOM_A, "General", []));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));
    notRoom = true;

    let r: boolean | undefined;
    await act(async () => {
      r = await result.current.send("into a non-room");
    });
    expect(r).toBe(false);
    expect(result.current.sendStatus).toBe("failed");
    expect(result.current.messages).toHaveLength(0);
  });

  it("discards a send whose room was closed before the write resolved (stale)", async () => {
    // Gate the message PUT; back out of the room while it's in flight, then
    // release. The stale resolve must NOT set a status or re-add the message.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = writablePod();
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && url.startsWith(MESSAGES) && url !== MESSAGES) {
        await gate;
      }
      return base.fetch(input, init);
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let sending: Promise<boolean>;
    act(() => {
      sending = result.current.send("stale");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    // Close the room while the write is in flight (marks the send stale).
    act(() => result.current.back());

    await act(async () => {
      release();
      await sending;
    });
    // Back-to-list reset the send state to idle; the stale resolve did not flip it.
    expect(result.current.sendStatus).toBe("idle");
    expect(result.current.openRoomUrl).toBeNull();
  });

  it("discards a send whose room was closed before the write REJECTED (stale catch)", async () => {
    // As above, but the gated message PUT FAILS. The catch's staleness guard must
    // swallow it: no "failed" status, no error, for a room left behind.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
          return new Response(null, { status: 412 });
        }
        if (url.startsWith(MESSAGES)) {
          await gate;
          return new Response(null, { status: 500 }); // fails AFTER the gate releases
        }
        return new Response(null, { status: 404 });
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useChat(POD, WEBID, { fetch }));
    await waitFor(() => expect(result.current.loadingRooms).toBe(false));
    act(() => result.current.open(ROOM_A));
    await waitFor(() => expect(result.current.loadingMessages).toBe(false));

    let sending: Promise<boolean>;
    act(() => {
      sending = result.current.send("stale failure");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => result.current.back()); // supersede the send before it rejects

    let r: boolean | undefined;
    await act(async () => {
      release();
      r = await sending;
    });
    // The send returns false (superseded) but DOES NOT surface a failed status /
    // error for the room we navigated away from.
    expect(r).toBe(false);
    expect(result.current.sendStatus).toBe("idle");
    expect(result.current.sendError).toBeNull();
    expect(result.current.openRoomUrl).toBeNull();
  });
});
