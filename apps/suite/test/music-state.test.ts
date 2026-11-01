// AUTHORED-BY Codex GPT-6
// biome-ignore-all assist/source/organizeImports: Establish the DOM before Radix computes browser capability flags.
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { TrackMenu } from "../src/apps/music/components/track-list";
import { createDocument, musicRoot, provision } from "../src/apps/music/lib/data/library";
import { createPlaylist } from "../src/apps/music/lib/data/playlists";
import { Store, Track } from "../src/apps/music/lib/model";
import { MusicProvider, useMusic } from "../src/apps/music/state/music-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { error: mocks.error },
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
const root = "https://state.test/";
let music: ReturnType<typeof useMusic>;
function Probe() {
  music = useMusic();
  return null;
}
async function fixture(
  wrap: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch = (fetch) => fetch,
  child: ReactNode = h(Probe),
) {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const dataset = new Store();
  const tracks = ["First", "Second"].map((name, i) => {
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
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(h(MusicProvider, { session, children: child }));
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
