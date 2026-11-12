// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all assist/source/organizeImports: Establish the DOM before React and Radix imports.
import { act, h, mount } from "./drive-ui-dom";
import { expect, it, vi } from "vitest";
import { PlayTrack } from "../src/apps/music/components/player";
import { MusicProvider, useMusic } from "../src/apps/music/state/music-context";
import { PlayerProvider, usePlayer } from "../src/apps/music/state/player-context";
import { createDocument, musicRoot, provision } from "../src/apps/music/lib/data/library";
import { loadHistory } from "../src/apps/music/lib/data/history";
import { Store, Track } from "../src/apps/music/lib/model";
import type { AudioStatus } from "../src/apps/music/lib/browser/audio";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
const audio = vi.hoisted(() => ({
  load: vi.fn(),
  restart: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  volume: vi.fn(),
  dispose: vi.fn(),
  update: (_status: AudioStatus) => {},
  ended: () => {},
}));
vi.mock("../src/apps/music/lib/browser/audio", () => ({
  createAudioEngine: (
    _fetch: unknown,
    _root: string,
    update: typeof audio.update,
    ended: typeof audio.ended,
  ) => {
    audio.update = update;
    audio.ended = ended;
    return audio;
  },
  mediaSession: () => () => {},
  mediaPlaybackState: () => {},
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
let player: ReturnType<typeof usePlayer>;
let music: ReturnType<typeof useMusic>;
function Probe() {
  player = usePlayer();
  music = useMusic();
  return player.current ? h(PlayTrack, { track: player.current }) : null;
}
it("keeps occurrence identities, restarts repeat/previous, supports keyboard navigation and records each qualified occurrence once", async () => {
  const root = "https://player.test/";
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const data = new Store();
  for (const [i, title] of ["First", "Second"].entries()) {
    const track = new Track(`${musicRoot(root)}tracks/a.ttl#${i}`, data).stampType();
    track.title = title;
    track.contentUrl = `${musicRoot(root)}files/${i}.wav`;
    track.durationSeconds = 10;
  }
  await createDocument(pod.fetch, root, `${musicRoot(root)}tracks/a.ttl`, data);
  const session: PodSession = {
    mode: "demo",
    webId: `${root}profile#me`,
    storageUrl: root,
    displayName: "Listener",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await mount(
    h(MusicProvider, { session, children: h(PlayerProvider, { session, children: h(Probe) }) }),
  );
  await vi.waitFor(() => expect(music.status).toBe("ready"));
  await act(async () => player.playTracks(music.snapshot?.library.tracks ?? []));
  expect(player.current?.title).toBe("First");
  expect(player.queue.entries).toHaveLength(2);
  const first = player.queue.currentId;
  const status: AudioStatus = {
    elapsed: 5,
    duration: 10,
    listened: 5,
    playing: true,
    wantsPlay: true,
    loading: false,
    error: "",
  };
  await act(async () => {
    audio.update({ ...status, listened: 4 });
  });
  expect(await loadHistory(pod.fetch, root, new Date())).toHaveLength(0);
  await act(async () => {
    audio.update(status);
    audio.update(status);
  });
  await vi.waitFor(async () =>
    expect(await loadHistory(pod.fetch, root, new Date())).toHaveLength(1),
  );
  await act(async () =>
    audio.update({ ...status, playing: false, loading: true, wantsPlay: true }),
  );
  expect(document.querySelector('button[aria-label="Pause First"]')).not.toBeNull();
  audio.pause.mockClear();
  await act(async () => player.toggle());
  expect(audio.pause).toHaveBeenCalledOnce();
  await act(async () =>
    audio.update({ ...status, playing: false, loading: true, wantsPlay: false }),
  );
  expect(document.querySelector('button[aria-label="Play First"]')).not.toBeNull();
  audio.play.mockClear();
  audio.pause.mockClear();
  await act(async () => player.toggle());
  expect(audio.play).toHaveBeenCalledOnce();
  expect(audio.pause).not.toHaveBeenCalled();
  await act(async () => audio.update(status));
  const loads = audio.load.mock.calls.length;
  await act(async () => {
    player.previous();
  });
  expect(player.queue.currentId).toBe(first);
  expect(audio.load.mock.calls.length).toBe(loads);
  expect(audio.restart).toHaveBeenCalledOnce();
  await act(async () => audio.update({ ...status, listened: 0, elapsed: 0 }));
  await act(async () => audio.update(status));
  await vi.waitFor(async () =>
    expect(await loadHistory(pod.fetch, root, new Date())).toHaveLength(2),
  );
  await act(async () => {
    player.dispatch({ type: "repeat", mode: "one" });
    audio.ended();
  });
  expect(player.queue.currentId).toBe(first);
  expect(audio.load.mock.calls.length).toBe(loads);
  expect(audio.restart).toHaveBeenCalledTimes(2);
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "N", shiftKey: true, bubbles: true }),
    );
  });
  expect(player.current?.title).toBe("Second");
  await act(async () => audio.update({ ...status, elapsed: 0 }));
  const sheet = document.createElement("div");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("data-music-player", "");
  document.body.append(sheet);
  await act(async () =>
    sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "P", shiftKey: true, bubbles: true })),
  );
  expect(player.current?.title).toBe("First");
  sheet.removeAttribute("data-music-player");
  await act(async () =>
    sheet.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true, bubbles: true })),
  );
  expect(player.current?.title).toBe("First");
  sheet.remove();
  await act(async () => player.next());
  const field = document.createElement("input");
  document.body.append(field);
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "P", shiftKey: true, bubbles: true }));
  });
  expect(player.current?.title).toBe("Second");
  field.remove();
  await act(async () => {
    player.enqueue(music.snapshot?.library.tracks[0] as NonNullable<typeof player.current>, true);
  });
  expect(new Set(player.queue.entries.map((entry) => entry.id)).size).toBe(3);
  await act(async () => player.clear());
  expect(player.queue.entries).toHaveLength(0);
  expect(audio.stop).toHaveBeenCalled();
});

async function keyboardPlayer() {
  const root = "https://keyboard.test/";
  const pod = createDemoPod({ root });
  const session: PodSession = {
    mode: "demo",
    webId: `${root}profile#me`,
    storageUrl: root,
    displayName: "Listener",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(
    h(MusicProvider, { session, children: h(PlayerProvider, { session, children: h(Probe) }) }),
  );
  await vi.waitFor(() => expect(music.status).toBe("ready"));
  audio.play.mockClear();
  audio.pause.mockClear();
  return view;
}

it.each([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  ...["button", "checkbox", "switch", "tab", "option", "menuitem", "slider", "radio"].map(
    (role) => `div role="${role}"`,
  ),
  'div contenteditable="true"',
  'div contenteditable=""',
])("leaves Space on %s and its descendants to that control", async (element) => {
  const view = await keyboardPlayer();
  const holder = document.createElement("div");
  holder.innerHTML = `<${element}></${element.split(" ")[0]}>`;
  const control = holder.firstElementChild as HTMLElement;
  view.host.append(holder);
  const child = document.createElement("span");
  control.append(child);
  for (const target of [control, child]) {
    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => target.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.pause).not.toHaveBeenCalled();
  }
});

it.each([
  undefined,
  "false",
])("toggles playback with Space on noneditable content (%s)", async (editable) => {
  const view = await keyboardPlayer();
  const target = document.createElement("div");
  if (editable !== undefined) target.setAttribute("contenteditable", editable);
  view.host.append(target);
  const event = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => target.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(audio.play).toHaveBeenCalledOnce();
});
