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
    // ROOM_B (a distinct room + message) supersedes it and resolves fast. When
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
