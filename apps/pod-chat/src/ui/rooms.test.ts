// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Unit tests for the room-list READ facade. The facade exists to distinguish a
// 401/403 on the rooms container (access-denied) from a genuinely empty/absent
// container (no rooms) — the data layer's ChatStore.listContainer swallows BOTH
// to [], which is wrong for a chat screen. Each branch is exercised directly.

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { listRoomsOrAccessError, RoomsAccessError } from "./rooms.js";

const ROOMS = "https://pod.example/pod-chat/rooms/";
const ROOM_A = `${ROOMS}general-aaa.ttl`;
const ROOM_B = `${ROOMS}team-bbb.ttl`;

/**
 * An LDP container listing of the given member resource URLs. `withSub` adds a
 * sub-container (which must be skipped); `withSelf` makes the container list
 * ITSELF in `ldp:contains` (the self-description row the facade must skip).
 */
function containerTtl(
  container: string,
  members: string[],
  { withSub = false, withSelf = false }: { withSub?: boolean; withSelf?: boolean } = {},
): string {
  const refs = [
    ...(withSelf ? [container] : []),
    ...members,
    ...(withSub ? [`${container}sub/`] : []),
  ]
    .map((m) => `<${m}>`)
    .join(", ");
  return `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${container}> a ldp:Container, ldp:BasicContainer${refs.length > 0 ? ` ;\n  ldp:contains ${refs}` : ""} .
${members.map((m) => `<${m}> a ldp:Resource .`).join("\n")}
${withSub ? `<${container}sub/> a ldp:Container .` : ""}
`;
}

function ttl(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
}

/** A fetch that answers the rooms container with `response`, else 404. */
function fetchFor(response: Response): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === ROOMS) return response.clone();
    return new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

describe("listRoomsOrAccessError", () => {
  it("lists direct resources sorted by name, skipping the self-description + sub-containers", async () => {
    const fetch = fetchFor(
      ttl(containerTtl(ROOMS, [ROOM_B, ROOM_A], { withSub: true, withSelf: true })),
    );
    const entries = await listRoomsOrAccessError(ROOMS, { fetch });
    expect(entries.map((e) => e.url)).toEqual([ROOM_A, ROOM_B]); // sorted, self + sub/ dropped
    expect(entries.every((e) => !e.isContainer)).toBe(true);
  });

  it("returns an empty list for an empty 2xx container (genuinely no rooms)", async () => {
    const fetch = fetchFor(ttl(containerTtl(ROOMS, [])));
    await expect(listRoomsOrAccessError(ROOMS, { fetch })).resolves.toEqual([]);
  });

  it("returns an empty list for a 404 container (not yet created — the new-pod case)", async () => {
    const fetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof globalThis.fetch;
    await expect(listRoomsOrAccessError(ROOMS, { fetch })).resolves.toEqual([]);
  });

  it("returns an empty list for a 410 container (gone)", async () => {
    const fetch = fetchFor(new Response(null, { status: 410 }));
    await expect(listRoomsOrAccessError(ROOMS, { fetch })).resolves.toEqual([]);
  });

  it("throws RoomsAccessError (401) instead of swallowing to empty", async () => {
    const fetch = fetchFor(new Response(null, { status: 401 }));
    await expect(listRoomsOrAccessError(ROOMS, { fetch })).rejects.toMatchObject({
      name: "RoomsAccessError",
      status: 401,
      url: ROOMS,
    });
  });

  it("throws RoomsAccessError (403) instead of swallowing to empty — the bug fix", async () => {
    const fetch = fetchFor(new Response("forbidden", { status: 403 }));
    const error = await listRoomsOrAccessError(ROOMS, { fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(RoomsAccessError);
    expect(error).toMatchObject({ status: 403, url: ROOMS });
    expect((error as RoomsAccessError).cause).toBeInstanceOf(RdfFetchError);
  });

  it("re-throws a non-access, non-404 failure (e.g. 500) unchanged", async () => {
    const fetch = fetchFor(new Response("boom", { status: 500 }));
    await expect(listRoomsOrAccessError(ROOMS, { fetch })).rejects.toMatchObject({ status: 500 });
  });

  it("re-throws a network/transport failure unchanged (no status → not access, not 404)", async () => {
    // A transport failure (the underlying fetch rejecting) surfaces from
    // @jeswr/fetch-rdf as an RdfFetchError WITHOUT a 401/403/404/410 status, so
    // it matches none of the mapped branches and must propagate as-is — the
    // facade never swallows it to an empty list.
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    const error = await listRoomsOrAccessError(ROOMS, { fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(RdfFetchError);
    expect((error as RdfFetchError).status).not.toBe(401);
    expect((error as RdfFetchError).status).not.toBe(403);
    expect((error as RdfFetchError).status).not.toBe(404);
  });

  it("falls back to the global fetch when none is injected", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fetchFor(ttl(containerTtl(ROOMS, [ROOM_A])));
    try {
      const entries = await listRoomsOrAccessError(ROOMS);
      expect(entries.map((e) => e.url)).toEqual([ROOM_A]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
