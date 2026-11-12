// AUTHORED-BY Codex GPT-6
// biome-ignore-all assist/source/organizeImports: Establish the DOM before Radix computes browser capability flags.
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

import { type ReactNode, useRef } from "react";
import { expect, it, vi } from "vitest";
import { AddSongs, EditPlaylistDetails } from "../src/apps/music/components/playlist-dialogs";
import { flac } from "./music-metadata-fixtures";
import { recordPlay } from "../src/apps/music/lib/data/history";
import { PlaylistTracks, TrackMenu } from "../src/apps/music/components/track-list";
import {
  createDocument,
  loadLibrary,
  musicRoot,
  provision,
} from "../src/apps/music/lib/data/library";
import {
  createPlaylist,
  editPlaylist,
  listPlaylists,
  type MusicPlaylist,
} from "../src/apps/music/lib/data/playlists";
import {
  Artist,
  historyShard,
  loadMusic,
  serializeMusic,
  Store,
  Track,
} from "../src/apps/music/lib/model";
import { PlayerProvider } from "../src/apps/music/state/player-context";
import { MusicProvider, useMusic } from "../src/apps/music/state/music-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { error: mocks.error },
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/music/lib/browser/audio", () => ({
  mediaPlaybackState: vi.fn(),
  createAudioEngine: () => ({ load: vi.fn(), stop: vi.fn(), dispose: vi.fn(), volume: vi.fn() }),
}));
const root = "https://state.test/";
let music: ReturnType<typeof useMusic>;
function Probe() {
  music = useMusic();
  return null;
}
async function fixture(
  wrap: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch = (fetch) => fetch,
  child: ReactNode = h(Probe),
  names = ["First", "Second"],
  notifications = true,
) {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const dataset = new Store();
  const tracks = names.map((name, i) => {
    const track = new Track(`${musicRoot(root)}tracks/a.ttl#${i}`, dataset).stampType();
    track.title = name;
    return track.value;
  });
  await createDocument(pod.fetch, root, `${musicRoot(root)}tracks/a.ttl`, dataset);
  await createPlaylist(pod.fetch, root, "one", "A playlist", "");
  const session: PodSession = {
    mode: "demo",
    webId: `${root}profile#me`,
    storageUrl: root,
    displayName: "Listener",
    fetch: wrap(pod.fetch),
    subscribe: notifications ? pod.subscribe : () => () => {},
    reset: async () => {},
  };
  const view = await mount(
    h(MusicProvider, { session, children: h(PlayerProvider, { session, children: child }) }),
  );
  return { pod, tracks, view };
}
async function ready() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(music.status).toBe("ready");
  });
}
async function settled() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(music.saving).toBe(false);
  });
}
it("shows queued edits immediately and preserves a newer edit when the older write fails", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let writes = 0;
  const { tracks } = await fixture((fetch) => async (input, init) => {
    if (init?.method === "PUT" && String(input).includes("tracks/a.ttl")) {
      writes++;
      if (writes === 1) return first.promise;
      if (writes === 2) {
        await second.promise;
        return fetch(input, init);
      }
    }
    return fetch(input, init);
  });
  await ready();
  await act(async () => {
    music.like(tracks[0] as string, true);
    music.like(tracks[1] as string, true);
  });
  expect(music.snapshot?.library.tracks.map((track) => track.loved)).toEqual([true, true]);
  await act(async () => {
    first.resolve(new Response(null, { status: 500 }));
  });
  await vi.waitFor(() => expect(writes).toBe(2));
  expect(music.snapshot?.library.tracks.map((track) => track.loved)).toEqual([false, true]);
  await act(async () => {
    second.resolve(new Response(null, { status: 200 }));
  });
  await settled();
  expect(music.snapshot?.library.tracks.map((track) => track.loved)).toEqual([false, true]);
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t save"));
});
it("does not resurrect an unconfirmed liked value when both queued writes fail", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  let writes = 0;
  const { tracks } = await fixture((fetch) => async (input, init) => {
    if (init?.method === "PUT" && String(input).includes("tracks/a.ttl"))
      return ++writes === 1 ? first.promise : second.promise;
    return fetch(input, init);
  });
  await ready();
  await act(async () => {
    music.like(tracks[0] as string, true);
    music.like(tracks[0] as string, false);
  });
  await act(async () => {
    first.resolve(new Response(null, { status: 500 }));
  });
  await vi.waitFor(() => expect(writes).toBe(2));
  await act(async () => {
    second.resolve(new Response(null, { status: 500 }));
  });
  await settled();
  expect(music.snapshot?.library.tracks[0]?.loved).toBe(false);
});
it("refetches after a 412, reports the conflict, and refreshes for pod events", async () => {
  const { pod, tracks } = await fixture(
    (fetch) => async (input, init) =>
      init?.method === "PUT" && String(input).includes("tracks/a.ttl")
        ? new Response(null, { status: 412 })
        : fetch(input, init),
  );
  await ready();
  await act(async () => music.like(tracks[0] as string, true));
  await settled();
  expect(music.snapshot?.library.tracks[0]?.loved).toBe(false);
  expect(music.notice).toContain("changed elsewhere");
  const dataset = new Store();
  new Track(`${musicRoot(root)}tracks/new.ttl#it`, dataset).stampType().title = "New song";
  await act(async () =>
    createDocument(pod.fetch, root, `${musicRoot(root)}tracks/new.ttl`, dataset),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(music.snapshot?.library.tracks).toHaveLength(3);
  });
});
it("surfaces load errors, clears stale data, and retries successfully", async () => {
  let offline = true;
  await fixture(
    (fetch) => async (input, init) =>
      offline && !init?.method ? new Response(null, { status: 500 }) : fetch(input, init),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(music.status).toBe("error");
  });
  expect(music.snapshot).toBeUndefined();
  offline = false;
  await act(async () => music.refresh());
  await ready();
  offline = true;
  await act(async () => music.refresh());
  expect(music.status).toBe("error");
  expect(music.snapshot).toBeUndefined();
});

it("opens Add to playlist from the row menu and restores focus when dismissed", async () => {
  function MenuProbe() {
    music = useMusic();
    const track = music.snapshot?.library.tracks[0];
    return track ? h(TrackMenu, { track }) : null;
  }
  const view = await fixture(undefined, h(MenuProbe));
  await ready();
  const trigger = view.view.host.querySelector<HTMLButtonElement>(
    'button[aria-label="More actions for First"]',
  ) as HTMLButtonElement;
  await act(async () => trigger.focus());
  await key(trigger, "ArrowDown");
  const add = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Add to playlist…",
  ) as Element;
  expect(add).toBeDefined();
  await click(add);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("A playlist");
  await key(document.activeElement as Element, "Escape");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

it.each([
  412, 500,
])("cancels dependent positional edits after a failed move (%i)", async (status) => {
  const move = deferred<Response>();
  let rejectMove = false;
  let writes = 0;
  const { pod, tracks } = await fixture(
    (fetch) => async (input, init) => {
      if (rejectMove && init?.method === "PUT" && String(input).endsWith("playlists/one.ttl")) {
        writes++;
        return move.promise;
      }
      return fetch(input, init);
    },
    h(Probe),
    ["First", "Second", "Third"],
  );
  await ready();
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "add", tracks }),
  );
  await settled();
  rejectMove = true;
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "move", from: 0, to: 1 }),
  );
  expect(music.snapshot?.playlists[0]?.tracks).toEqual([tracks[1], tracks[0], tracks[2]]);
  // Remove B at its optimistic position, while the preceding move remains unresolved.
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "remove", position: 0 }),
  );
  expect(music.snapshot?.playlists[0]?.tracks).toEqual([tracks[0], tracks[2]]);
  await act(async () => move.resolve(new Response(null, { status })));
  await settled();
  expect(writes).toBe(1);
  expect(music.snapshot?.playlists[0]?.tracks).toEqual(tracks);
  expect(listPlaylists(await loadLibrary(pod.fetch, root))[0]?.tracks).toEqual(tracks);
  expect(music.notice).toContain("Queued song moves and removals were cancelled");
  rejectMove = false;
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "remove", position: 1 }),
  );
  await settled();
  expect(music.snapshot?.playlists[0]?.tracks).toEqual([tracks[0], tracks[2]]);
});

it("rejects positional edits captured while a failed move is still reconciling", async () => {
  const move = deferred<Response>();
  const read = deferred<void>();
  let moving = false;
  let slowRead = false;
  let reading = false;
  let writes = 0;
  const { tracks } = await fixture((fetch) => async (input, init) => {
    if (String(input).endsWith("playlists/one.ttl")) {
      if (moving && init?.method === "PUT" && ++writes === 1) return move.promise;
      if (slowRead && !init?.method) {
        slowRead = false;
        reading = true;
        await read.promise;
      }
    }
    return fetch(input, init);
  });
  await ready();
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "add", tracks }),
  );
  await settled();
  moving = true;
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "move", from: 0, to: 1 }),
  );
  slowRead = true;
  await act(async () => move.resolve(new Response(null, { status: 412 })));
  await vi.waitFor(() => expect(reading).toBe(true));
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "remove", position: 0 }),
  );
  await act(async () => read.resolve());
  await settled();
  expect(writes).toBe(1);
  expect(music.snapshot?.playlists[0]?.tracks).toEqual(tracks);
});

it("returns a committed playlist and retains it when subsequent GETs fail, then reconciles separately", async () => {
  let blockReads = false;
  const { pod } = await fixture((fetch) => async (input, init) => {
    if (!init?.method && blockReads) return new Response(null, { status: 500 });
    const response = await fetch(input, init);
    if (init?.method === "PUT" && String(input).includes("playlists/")) blockReads = true;
    return response;
  });
  await ready();
  mocks.error.mockClear();
  let created: string | undefined;
  await act(async () => {
    created = await music.create("Committed once", "Still here");
  });
  expect(created).toBeDefined();
  expect(music.snapshot?.playlists.find((p) => p.id === created)?.name).toBe("Committed once");
  expect(music.notice).toContain("refresh Music to retry");
  expect(mocks.error).not.toHaveBeenCalled();
  await act(async () => music.refresh());
  expect(music.status).toBe("ready");
  expect(music.snapshot?.playlists.find((p) => p.id === created)).toBeDefined();
  blockReads = false;
  await act(async () => music.refresh());
  expect(music.snapshot?.playlists.filter((p) => p.name === "Committed once")).toHaveLength(1);
  expect(
    listPlaylists(await loadLibrary(pod.fetch, root)).filter((p) => p.name === "Committed once"),
  ).toHaveLength(1);
});

it("reports a committed like with pending mirror work and repairs it on refresh", async () => {
  let fail = true;
  let trackWrites = 0;
  const { tracks } = await fixture((fetch) => async (input, init) => {
    if (init?.method === "PUT") {
      if (String(input).endsWith("liked.ttl") && fail) return new Response(null, { status: 500 });
      if (String(input).includes("tracks/")) trackWrites++;
    }
    return fetch(input, init);
  });
  await ready();
  await act(async () => music.like(tracks[0] as string, true));
  await settled();
  expect(music.snapshot?.library.tracks[0]?.loved).toBe(true);
  expect(music.notice).toContain("Playlist synchronization is pending");
  fail = false;
  await act(async () => music.refresh());
  expect(
    music.snapshot?.library.models.playlists.find((p) => p.title === "Liked songs")?.tracks,
  ).toEqual([tracks[0]]);
  expect(trackWrites).toBe(1);
});

it.each([
  "Move up",
  "Move down",
])("restores focus to the moved occurrence after keyboard menu %s", async (action) => {
  function PlaylistProbe() {
    music = useMusic();
    const playlist = music.snapshot?.playlists[0];
    return playlist ? h(PlaylistTracks, { playlist }) : null;
  }
  const { tracks, view } = await fixture(undefined, h(PlaylistProbe));
  await ready();
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, { kind: "add", tracks }),
  );
  await settled();
  const title = action === "Move up" ? "Second" : "First";
  const position = action === "Move up" ? 1 : 2;
  const trigger = view.host.querySelector(
    `button[aria-label="More actions for ${title}"]`,
  ) as HTMLButtonElement;
  await act(async () => trigger.focus());
  await key(trigger, "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === action,
  ) as HTMLElement;
  await act(async () => item.focus());
  await key(item, "Enter");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      `Reorder ${title}, position ${position}`,
    );
  });
  await settled();
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    `Reorder ${title}, position ${position}`,
  );
});

it("edits playlist details in a dialog and returns focus to the action after saving", async () => {
  function DetailsProbe() {
    music = useMusic();
    const playlist = music.snapshot?.playlists[0];
    return playlist ? h(EditPlaylistDetails, { playlist }) : null;
  }
  const { view } = await fixture(undefined, h(DetailsProbe));
  await ready();
  const trigger = view.host.querySelector("button") as HTMLButtonElement;
  await act(async () => trigger.focus());
  await click(trigger);
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  const input = dialog.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "New title",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    dialog
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settled();
  expect(music.snapshot?.playlists[0]?.name).toBe("New title");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

async function fillDetails(field: "Name" | "Description", value: string) {
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  const input = dialog.querySelector(field === "Name" ? "input" : "textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement;
  await act(async () => {
    const prototype =
      field === "Name" ? HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submitDetails() {
  await act(async () => {
    document
      .querySelector('[role="dialog"] form')
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settled();
}
function DetailsProbe() {
  music = useMusic();
  const playlist = music.snapshot?.playlists[0];
  return playlist ? h(EditPlaylistDetails, { playlist }) : null;
}

it.each([
  "Name",
  "Description",
] as const)("merges only the changed %s field against the dialog opening snapshot", async (field) => {
  const { pod, view } = await fixture(undefined, h(DetailsProbe));
  await ready();
  await click(view.host.querySelector("button") as HTMLElement);
  await fillDetails(field, "My edit");
  await editPlaylist(pod.fetch, root, music.snapshot?.playlists[0] as MusicPlaylist, {
    kind: "rename",
    ...(field === "Name"
      ? { description: "Another tab's description" }
      : { name: "Another tab's name" }),
  });
  await act(async () => music.refresh());
  await submitDetails();
  const expected =
    field === "Name"
      ? { name: "My edit", description: "Another tab's description" }
      : { name: "Another tab's name", description: "My edit" };
  expect(music.snapshot?.playlists[0]).toMatchObject(expected);
  expect(listPlaylists(await loadLibrary(pod.fetch, root))[0]).toMatchObject(expected);
});

it.each([
  "Name",
  "Description",
] as const)("reports a conflict when the dialog's %s field changed in another tab", async (field) => {
  const { pod, view } = await fixture(undefined, h(DetailsProbe));
  await ready();
  await click(view.host.querySelector("button") as HTMLElement);
  await fillDetails(field, "My edit");
  await editPlaylist(pod.fetch, root, music.snapshot?.playlists[0] as MusicPlaylist, {
    kind: "rename",
    ...(field === "Name" ? { name: "Other edit" } : { description: "Other edit" }),
  });
  await act(async () => music.refresh());
  mocks.error.mockClear();
  await submitDetails();
  expect(music.notice).toContain("changed elsewhere");
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"));
  expect(
    listPlaylists(await loadLibrary(pod.fetch, root))[0]?.[
      field === "Name" ? "name" : "description"
    ],
  ).toBe("Other edit");
});

it("uses the confirmed artwork snapshot for a second save after reconciliation GETs fail", async () => {
  let failedReads = false;
  const preconditions: (string | null)[] = [];
  const { pod } = await fixture((fetch) => async (input, init) => {
    if (failedReads && !init?.method) return new Response(null, { status: 500 });
    const response = await fetch(input, init);
    if (init?.method === "PUT" && String(input).endsWith("preferences.json")) {
      preconditions.push(new Headers(init.headers).get("If-Match"));
      failedReads = true;
    }
    return response;
  });
  await ready();
  mocks.error.mockClear();
  await act(async () => music.artwork(true));
  await settled();
  expect(music.snapshot?.preferences.value.artwork).toBe("hot-link");
  const confirmed = music.snapshot?.preferences.etag;
  expect(confirmed).toBeTruthy();
  await act(async () => music.artwork(false));
  await settled();
  expect(preconditions).toEqual([null, confirmed]);
  expect(music.snapshot?.preferences.value.artwork).toBe("none");
  expect(music.snapshot?.preferences.etag).not.toBe(confirmed);
  expect(await (await pod.fetch(`${musicRoot(root)}preferences.json`)).json()).toEqual({
    artwork: "none",
  });
  expect(mocks.error).not.toHaveBeenCalled();
});

it("retains confirmed track ETags for queued likes when reconciliation and mirror reads fail", async () => {
  let failedReads = false;
  const preconditions: string[] = [];
  const { pod, tracks } = await fixture((fetch) => async (input, init) => {
    if (failedReads && !init?.method && !String(input).endsWith("tracks/a.ttl"))
      return new Response(null, { status: 500 });
    const response = await fetch(input, init);
    if (init?.method === "PUT" && String(input).endsWith("tracks/a.ttl")) {
      preconditions.push(new Headers(init.headers).get("If-Match") as string);
      failedReads = true;
    }
    return response;
  });
  await ready();
  await act(async () => {
    music.like(tracks[0] as string, true);
    music.like(tracks[1] as string, true);
  });
  await settled();
  expect(preconditions).toHaveLength(2);
  expect(preconditions[1]).not.toBe(preconditions[0]);
  expect((await loadLibrary(pod.fetch, root)).tracks.map((track) => track.loved)).toEqual([
    true,
    true,
  ]);
  expect(music.snapshot?.library.tracks.map((track) => track.loved)).toEqual([true, true]);
});

it.each([
  "refresh",
  "write reconciliation",
])("keeps paginated history when an earlier %s completes after the older load", async (operation) => {
  const read = deferred<void>();
  let delay = false;
  let reading = false;
  const { pod, tracks } = await fixture(
    (fetch) => async (input, init) => {
      const response = await fetch(input, init);
      if (delay && !init?.method && String(input) === musicRoot(root)) {
        delay = false;
        reading = true;
        await read.promise;
      }
      return response;
    },
    h(Probe),
    ["First", "Second"],
    false,
  );
  await ready();
  const date = new Date();
  const older = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 13, 10));
  const play = {
    iri: `${historyShard(musicRoot(root), older)}#older`,
    trackIri: tracks[0] as string,
    startTime: older,
  };
  await recordPlay(pod.fetch, root, play);
  delay = true;
  let refresh!: Promise<unknown>;
  await act(async () => {
    refresh =
      operation === "refresh" ? music.refresh() : music.create("Created during pagination", "");
  });
  await vi.waitFor(() => expect(reading).toBe(true));
  await act(async () => {
    const first = music.older();
    expect(music.older()).toBe(first);
    await first;
  });
  expect(music.snapshot?.history.map((item) => item.iri)).toContain(play.iri);
  await act(async () => {
    read.resolve();
    await refresh;
  });
  expect(music.snapshot?.history.map((item) => item.iri)).toContain(play.iri);
  await act(async () => music.older());
  await act(async () => music.refresh());
  expect(music.snapshot?.history.filter((item) => item.iri === play.iri)).toHaveLength(1);
});

it.each([
  { remove: 0, repeat: true, expected: "Reorder Second, position 1" },
  { remove: 2, repeat: true, expected: "Reorder Second, position 2" },
  { remove: 0, repeat: false, expected: "Add songs" },
])("restores keyboard focus after removing occurrence $remove (repeated: $repeat)", async ({
  remove,
  repeat,
  expected,
}) => {
  function PlaylistProbe() {
    music = useMusic();
    const add = useRef<HTMLButtonElement>(null);
    const playlist = music.snapshot?.playlists[0];
    return playlist
      ? h(
          "div",
          {},
          h(AddSongs, { playlist, triggerRef: add }),
          h(PlaylistTracks, { playlist, emptyFocus: add }),
        )
      : null;
  }
  const { pod, tracks, view } = await fixture(undefined, h(PlaylistProbe));
  await ready();
  await act(async () =>
    music.edit(music.snapshot?.playlists[0] as MusicPlaylist, {
      kind: "add",
      tracks: repeat
        ? [tracks[0] as string, tracks[1] as string, tracks[0] as string]
        : [tracks[0] as string],
    }),
  );
  await settled();
  const trigger = view.host.querySelectorAll(
    '.mus-playlist-row button[aria-label="More actions for First"]',
  )[remove === 2 ? 1 : 0] as HTMLButtonElement;
  await act(async () => trigger.focus());
  await key(trigger, "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === "Remove from playlist",
  ) as HTMLElement;
  await act(async () => item.focus());
  await key(item, "Enter");
  const focusLabel = () =>
    document.activeElement?.getAttribute("aria-label") ??
    document.activeElement?.textContent?.trim();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(focusLabel()).toBe(expected);
  });
  await settled();
  expect(focusLabel()).toBe(expected);
  expect(listPlaylists(await loadLibrary(pod.fetch, root))[0]?.tracks).toEqual(
    music.snapshot?.playlists[0]?.tracks,
  );
});

it("reports duplicate uploads as already in the library and keeps a specific audio conflict", async () => {
  let race = false;
  let reads = 0;
  const target = `${musicRoot(root)}tracks/a.ttl`;
  const { pod, tracks } = await fixture(
    (fetch) => async (input, init) => {
      if (race && String(input) === target && !init?.method && ++reads === 3) {
        const doc = await loadMusic(fetch, target);
        new Track(tracks[0] as string, doc.dataset).contentUrl =
          `${musicRoot(root)}files/winner.wav`;
        await fetch(target, {
          method: "PUT",
          headers: { "Content-Type": "text/turtle", "If-Match": doc.etag as string },
          body: await serializeMusic(doc.dataset),
        });
      }
      return fetch(input, init);
    },
    h(Probe),
    ["Paper Moon"],
    false,
  );
  const doc = await loadMusic(pod.fetch, target);
  const artist = new Artist(`${target}#artist`, doc.dataset).stampType();
  artist.title = "Mira Example";
  new Track(tracks[0] as string, doc.dataset).setArtist(artist.value);
  await pod.fetch(target, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle", "If-Match": doc.etag as string },
    body: await serializeMusic(doc.dataset),
  });
  await ready();
  const file = { name: "song.flac", type: "audio/flac", bytes: flac().buffer };
  race = true;
  await act(async () => expect(await music.importFile(file)).toBe(false));
  expect(music.notice).toBe("This song already has an audio file. Its existing file was kept.");
  expect(mocks.error).toHaveBeenLastCalledWith(music.notice);
  race = false;
  await act(async () =>
    expect(await music.importFile(file)).toMatchObject({ status: "already-owned" }),
  );
  expect(music.notice).toBe("Already in your library");
});
