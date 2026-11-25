// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all assist/source/organizeImports: Establish the DOM before Radix imports.
import { act, click, deferred, h, mount } from "./drive-ui-dom";
import { expect, it, vi } from "vitest";
import { MusicScreen, type MusicView } from "../src/apps/music/components/music-screen";
import { AddSongs } from "../src/apps/music/components/playlist-dialogs";
import { ScrobbleImport } from "../src/apps/music/components/scrobble-import";
import { loadHistory, recordPlay } from "../src/apps/music/lib/data/history";
import {
  createDocument,
  loadLibrary,
  type MusicReadFailure,
  musicRoot,
  provision,
} from "../src/apps/music/lib/data/library";
import { createPlaylist } from "../src/apps/music/lib/data/playlists";
import { Album, historyShard, Store, Track } from "../src/apps/music/lib/model";
import { MusicProvider, useMusic } from "../src/apps/music/state/music-context";
import { PlayerProvider } from "../src/apps/music/state/player-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

vi.stubGlobal("matchMedia", window.matchMedia);

const auth = vi.hoisted(() => ({ reauth: vi.fn(), active: { kind: "solid" } }));
vi.mock("@/shell/session/accounts-context", () => ({ useOptionalAccounts: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/apps/music/lib/browser/audio", () => ({
  mediaPlaybackState: vi.fn(),
  createAudioEngine: () => ({ load: vi.fn(), stop: vi.fn(), dispose: vi.fn(), volume: vi.fn() }),
}));

const root = "https://states.test/";
const base = musicRoot(root);
let music: ReturnType<typeof useMusic>;
function Probe() {
  music = useMusic();
  return null;
}
const emptyViews = [
  ["home", "No music yet"],
  ["tracks", "No tracks yet"],
  ["albums", "No albums yet"],
  ["artists", "No artists yet"],
  ["liked", "No liked songs yet"],
  ["search", "No music to search yet"],
  ["playlists", "No playlists yet"],
  ["history", "No listening history yet"],
  ["import", "No listening history yet"],
] as const;
async function open({
  view = "tracks",
  existing = false,
  songs = false,
  query = "",
  wrap = (fetch) => fetch,
}: {
  view?: MusicView | "import";
  existing?: boolean;
  songs?: boolean;
  query?: string;
  wrap?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;
} = {}) {
  const pod = createDemoPod({ root });
  if (existing || songs) await provision(pod.fetch, root);
  if (songs) {
    for (const name of ["Good", "Broken"]) {
      const url = `${base}tracks/${name}.ttl`;
      const dataset = new Store();
      new Track(`${url}#it`, dataset).stampType().title = name;
      await createDocument(pod.fetch, root, url, dataset);
    }
  }
  const session: PodSession = {
    mode: "solid",
    publicFetch: pod.fetch,
    webId: `${root}profile#me`,
    displayName: "Listener",
    storageUrl: root,
    fetch: wrap(pod.fetch),
    subscribe: () => () => {},
  };
  const screen = () => (view === "import" ? h(ScrobbleImport) : h(MusicScreen, { view, query }));
  const ui = await mount(
    h(MusicProvider, {
      session,
      children: h(PlayerProvider, {
        session,
        children: h("div", { className: "mus-content" }, h(Probe), screen()),
      }),
    }),
  );
  return { pod, ui, session };
}
async function loaded(status = "empty") {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(music.status).toBe(status);
  });
}
function button(host: ParentNode, name: string) {
  const found = [...host.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

it.each(
  emptyViews,
)("gives %s an actionable first-run state for absent and empty containers", async (view, title) => {
  for (const existing of [false, true]) {
    const { ui } = await open({ view, existing });
    await loaded();
    expect(ui.host.querySelectorAll("h1")).toHaveLength(1);
    const empty = [...ui.host.querySelectorAll(".suite-async-state")].find(
      (node) => node.querySelector("h3")?.textContent === title,
    );
    expect(empty).toBeDefined();
    expect(empty?.querySelector("p")?.textContent?.length).toBeGreaterThan(10);
    const action = empty?.querySelector("button, a, input") as HTMLElement;
    expect(action).not.toBeNull();
    expect(action.hasAttribute("disabled")).toBe(false);
    await act(async () => action.focus());
    expect(document.activeElement).toBe(action);
    if (view === "tracks") {
      await click(action);
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Choose audio files and lyrics",
      );
    }
    await ui.unmount();
  }
});

it("announces loading without flashing an empty state", async () => {
  const pending = deferred<void>();
  const { ui } = await open({
    wrap: (fetch) => async (input, init) => {
      if (String(input) === base) await pending.promise;
      return fetch(input, init);
    },
  });
  expect(ui.host.querySelector('[role="status"][aria-label="Loading your music"]')).not.toBeNull();
  expect(ui.host.querySelector('[data-variant="first-use"]')).toBeNull();
  await act(async () => pending.resolve());
  await loaded();
  expect(ui.host.textContent).toContain("No tracks yet");
});

it.each([
  401,
  403,
  500,
  "network",
  "turtle",
] as const)("re-reads after a whole-view %s failure and restores focus", async (failure) => {
  let broken = true;
  let reads = 0;
  const { ui } = await open({
    songs: true,
    wrap: (fetch) => async (input, init) => {
      if (String(input) === base) {
        reads++;
        if (broken) {
          if (failure === "network") throw new TypeError("secret transport details");
          return failure === "turtle"
            ? new Response("not valid Turtle {{{", { headers: { "Content-Type": "text/turtle" } })
            : new Response(null, { status: failure });
        }
      }
      return fetch(input, init);
    },
  });
  await loaded("error");
  expect(ui.host.textContent).toContain("Couldn’t read your music library");
  expect(ui.host.textContent).not.toContain("secret transport details");
  expect(ui.host.textContent).not.toContain("No tracks yet");
  if (failure === 401 || failure === 403) expect(button(ui.host, "Sign in")).toBeDefined();
  const before = reads;
  await click(button(ui.host, "Retry"));
  expect(reads).toBeGreaterThan(before);
  expect(document.activeElement).toBe(ui.host.querySelector("h1"));
  expect(ui.host.textContent).not.toContain("No tracks yet");
  broken = false;
  await click(button(ui.host, "Retry"));
  await loaded("ready");
  expect(reads).toBeGreaterThan(before);
  expect(ui.host.querySelector(".suite-error-state")).toBeNull();
  expect(document.activeElement).toBe(ui.host.querySelector("h1"));
});

it("keeps loaded tracks visible when a background root read fails", async () => {
  let broken = false;
  const { ui } = await open({
    songs: true,
    wrap: (fetch) => async (input, init) =>
      broken && String(input) === base ? new Response(null, { status: 500 }) : fetch(input, init),
  });
  await loaded("ready");
  broken = true;
  await act(async () => music.refresh());
  expect(music.status).toBe("error");
  expect(music.snapshot?.library.tracks).toHaveLength(2);
  expect(ui.host.textContent).toContain("Good");
  expect(ui.host.textContent).toContain("Couldn’t read your music library");
});

it.each([
  404,
  403,
  500,
  "turtle",
] as const)("retains good items, reports a listed %s failure, dismisses and retries", async (failure) => {
  let broken = true;
  const { ui } = await open({
    songs: true,
    wrap: (fetch) => async (input, init) => {
      if (broken && String(input) === `${base}tracks/Broken.ttl`)
        return failure === "turtle"
          ? new Response("bad Turtle {{{", { headers: { "Content-Type": "text/turtle" } })
          : new Response(null, { status: failure });
      return fetch(input, init);
    },
  });
  await loaded("ready");
  expect(music.snapshot?.library.tracks.map((track) => track.title)).toEqual(["Good"]);
  expect(ui.host.querySelector(".suite-error-state")).toBeNull();
  expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain("1 item couldn’t be read");
  await click(ui.host.querySelector('[aria-label="Dismiss music notice"]') as HTMLElement);
  expect(ui.host.querySelector('[role="alert"]')).toBeNull();
  expect(document.activeElement).toBe(ui.host.querySelector("h1"));
  await act(async () => music.refresh());
  broken = false;
  await click(button(ui.host, "Retry"));
  expect(music.snapshot?.library.tracks).toHaveLength(2);
  expect(ui.host.querySelector('[role="alert"]')).toBeNull();
});

it("treats a missing listed required document as an error rather than an empty library", async () => {
  const { ui } = await open({
    songs: true,
    wrap: (fetch) => async (input, init) =>
      String(input).includes("tracks/") && String(input).endsWith(".ttl")
        ? new Response(null, { status: 404 })
        : fetch(input, init),
  });
  await loaded();
  expect(ui.host.querySelector(".suite-error-state")).not.toBeNull();
  expect(ui.host.textContent).not.toContain("No tracks yet");
});

it("keeps readable months and recovers the failed month on Retry", async () => {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10));
  const bad = historyShard(base, previous);
  let broken = true;
  const { pod, ui } = await open({
    view: "history",
    existing: true,
    wrap: (fetch) => async (input, init) =>
      broken && String(input) === bad
        ? new Response("broken {{{", { headers: { "Content-Type": "text/turtle" } })
        : fetch(input, init),
  });
  for (const date of [now, previous])
    await recordPlay(pod.fetch, root, {
      iri: `${historyShard(base, date)}#it`,
      trackIri: `${base}tracks/Good.ttl#it`,
      startTime: date,
    });
  await act(async () => music.refresh());
  expect(music.snapshot?.history).toHaveLength(1);
  expect(ui.host.querySelector(".mus-timeline")).not.toBeNull();
  expect(ui.host.textContent).toContain("1 item couldn’t be read");
  broken = false;
  await click(button(ui.host, "Retry"));
  expect(music.snapshot?.history).toHaveLength(2);
});

it("does not mistake unreadable history for first-run history", async () => {
  const { ui } = await open({
    view: "history",
    songs: true,
    wrap: (fetch) => async (input, init) =>
      String(input).includes("history/") ? new Response(null, { status: 500 }) : fetch(input, init),
  });
  await loaded("ready");
  expect(ui.host.textContent).toContain("Couldn’t read your listening history");
  expect(ui.host.textContent).not.toContain("No listening history yet");
});

it("reports preferences separately and retries without hiding the library", async () => {
  let broken = true;
  const { ui } = await open({
    songs: true,
    wrap: (fetch) => async (input, init) =>
      broken && String(input).endsWith("preferences.json")
        ? new Response(null, { status: 403 })
        : fetch(input, init),
  });
  await loaded("ready");
  expect(music.snapshot?.failures).toEqual([expect.objectContaining({ area: "preferences" })]);
  expect(ui.host.textContent).toContain("Good");
  broken = false;
  await click(button(ui.host, "Retry"));
  expect(music.snapshot?.failures).toEqual([]);
});

it("creates the containers before filling a playlist on a new pod", async () => {
  const { pod } = await open();
  await loaded();
  await act(async () => expect(await music.create("First playlist", "")).toBeDefined());
  expect(pod.has(`${base}playlists/`)).toBe(true);
  expect(music.snapshot?.playlists[0]?.name).toBe("First playlist");
});

it("lets an empty playlist's song picker add the library's first files", async () => {
  function Picker() {
    const current = useMusic();
    const playlist = current.snapshot?.playlists[0];
    return playlist ? h(AddSongs, { playlist }) : null;
  }
  const { session, ui } = await open();
  await loaded();
  await act(async () => music.create("Empty playlist", ""));
  await ui.unmount();
  const view = await mount(h(MusicProvider, { session, children: h(Picker) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toContain("Add songs");
  });
  await click(button(view.host, "Add songs"));
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog.textContent).toContain("No tracks to add yet");
  await click(button(dialog, "Add music files"));
  expect(document.querySelector("#mus-audio-files")).not.toBeNull();
});

it("reports integration failures while retaining the local library and history", async () => {
  const { pod } = await open({ songs: true });
  const failures: MusicReadFailure[] = [];
  const broken: typeof fetch = async (input, init) =>
    String(input).includes("integrations/")
      ? new Response(null, { status: 500 })
      : pod.fetch(input, init);
  expect(
    (await loadLibrary(broken, root, (failure) => failures.push(failure))).tracks,
  ).toHaveLength(2);
  expect(
    await loadHistory(broken, root, new Date(), 1, 0, (failure) => failures.push(failure)),
  ).toEqual([]);
  expect(failures.map((failure) => failure.area)).toEqual(["library", "history"]);
  await expect(loadLibrary(broken, root)).rejects.toMatchObject({ status: 500 });
  await createPlaylist(pod.fetch, root, "kept", "Kept", "");
});

it("keeps strict library reads strict when a listed child fails", async () => {
  const { pod } = await open({ songs: true });
  const fail =
    (status: number): typeof fetch =>
    async (input, init) =>
      String(input).endsWith("Broken.ttl")
        ? new Response(null, { status })
        : pod.fetch(input, init);
  await expect(loadLibrary(fail(500), root)).rejects.toMatchObject({ status: 500 });
  expect((await loadLibrary(fail(404), root)).tracks).toHaveLength(1);
});

it("offers sign-in recovery for an access failure", async () => {
  let blocked = true;
  auth.reauth.mockImplementationOnce(async () => {
    blocked = false;
  });
  const { ui } = await open({
    songs: true,
    wrap: (fetch) => async (input, init) =>
      blocked && String(input) === base ? new Response(null, { status: 401 }) : fetch(input, init),
  });
  await loaded("error");
  await click(button(ui.host, "Sign in"));
  await loaded("ready");
  expect(auth.reauth).toHaveBeenCalled();
  expect(document.activeElement).toBe(ui.host.querySelector("h1"));
});

it("distinguishes a search with no matches from a first-run library", async () => {
  const { ui } = await open({ view: "search", songs: true, query: "No match" });
  await loaded("ready");
  expect(ui.host.textContent).toContain("No results for 'No match'");
  expect(ui.host.textContent).not.toContain("No music to search yet");
  expect(ui.host.querySelector('a[href="/music/tracks"]')?.textContent).toBe("Browse all tracks");
});

it("clears a file filter that hides the library's existing tracks", async () => {
  const { ui } = await open({ songs: true });
  await loaded("ready");
  await click(button(ui.host, "Your files"));
  expect(ui.host.textContent).toContain("No music files in your library");
  expect(ui.host.textContent).not.toContain("No tracks yet");
  await click(button(ui.host, "Show all tracks"));
  expect(ui.host.textContent).toContain("Good");
  expect(ui.host.querySelector('[data-variant="filtered-empty"]')).toBeNull();
});

it.each([
  "album",
  "artist",
  "playlist",
] as const)("gives an unavailable %s a way to add music on a new pod", async (view) => {
  const { ui } = await open({ view });
  await loaded();
  expect(ui.host.textContent).toContain("This item is unavailable");
  expect(button(ui.host, "Add music files")).toBeDefined();
});

it("keeps readable album metadata visible when all track documents fail", async () => {
  const { pod, ui } = await open({
    view: "albums",
    songs: true,
    wrap: (fetch) => async (input, init) =>
      String(input).includes("tracks/") && String(input).endsWith(".ttl")
        ? new Response(null, { status: 500 })
        : fetch(input, init),
  });
  const dataset = new Store();
  new Album(`${base}albums/kept.ttl#it`, dataset).stampType().title = "Kept album";
  await createDocument(pod.fetch, root, `${base}albums/kept.ttl`, dataset);
  await act(async () => music.refresh());
  expect(ui.host.textContent).toContain("Kept album");
  expect(ui.host.textContent).toContain("2 items couldn’t be read");
  expect(ui.host.textContent).not.toContain("No albums yet");
  expect(ui.host.querySelector(".suite-error-state")).toBeNull();
});

it("keeps readable history visible even when the library root fails", async () => {
  const { pod, ui } = await open({
    view: "history",
    wrap: (fetch) => async (input, init) =>
      String(input) === base ? new Response(null, { status: 500 }) : fetch(input, init),
  });
  const now = new Date();
  await recordPlay(pod.fetch, root, {
    iri: `${historyShard(base, now)}#it`,
    trackIri: `${base}tracks/Good.ttl#it`,
    startTime: now,
  });
  await act(async () => music.refresh());
  expect(music.status).toBe("error");
  expect(ui.host.querySelector(".mus-timeline")).not.toBeNull();
  expect(ui.host.textContent).toContain("Couldn’t read your music library");
});

it("retains paginated plays on a partial older load and retries the extended range", async () => {
  const now = new Date();
  const dates = [
    now,
    ...[13, 14].map(
      (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 10)),
    ),
  ];
  const bad = historyShard(base, dates[1] as Date);
  let broken = true;
  const { pod, ui } = await open({
    view: "history",
    wrap: (fetch) => async (input, init) =>
      broken && String(input) === bad ? new Response(null, { status: 500 }) : fetch(input, init),
  });
  for (const date of dates)
    await recordPlay(pod.fetch, root, {
      iri: `${historyShard(base, date)}#it`,
      trackIri: `${base}tracks/Good.ttl#it`,
      startTime: date,
    });
  await act(async () => music.refresh());
  await act(async () => music.older());
  expect(music.snapshot?.history).toHaveLength(2);
  expect(ui.host.textContent).toContain("1 item couldn’t be read");
  broken = false;
  await click(button(ui.host, "Retry"));
  expect(music.snapshot?.history).toHaveLength(3);
});
