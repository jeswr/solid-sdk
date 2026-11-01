// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import { PhotosProvider, usePhotos } from "../src/apps/photos/state/photos-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

const messages = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: Object.assign(vi.fn(), messages) }));
const ROOT = "https://state.demo.pod/";
const NOW = "2026-11-01T12:00:00Z";
async function setup() {
  const pod = createDemoPod({ root: ROOT });
  let intercept: ((url: string, method: string) => Promise<Response | undefined>) | undefined;
  const omitEtags = new Set<string>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const handled = await intercept?.(String(input), init?.method ?? "GET");
    const response = handled ?? (await pod.fetch(input, init));
    if (init?.method === "PUT" && omitEtags.has(String(input))) response.headers.delete("etag");
    return response;
  };
  const io = photoDataStorage(fetch, ROOT);
  await uploadFiles(
    io,
    [
      {
        name: "First.png",
        original: new Blob([Uint8Array.from(atob(scenes[0][0]), (c) => c.charCodeAt(0))], {
          type: "image/png",
        }),
      },
    ],
    {
      encoder: {
        dimensions: async () => ({ width: 160, height: 100 }),
        stripLocation: async (v) => v,
        thumbnail: async () => new Blob(["thumb"], { type: "image/webp" }),
      },
      stripLocation: false,
      id: () => "one",
      now: NOW,
    },
  );
  const session: PodSession = {
    mode: "demo",
    webId: `${ROOT}profile#me`,
    storageUrl: ROOT,
    displayName: "Me",
    fetch,
    subscribe: () => () => {},
    reset: async () => {},
  };
  let state!: ReturnType<typeof usePhotos>;
  function Probe() {
    state = usePhotos();
    return null;
  }
  let view = await mount(h(PhotosProvider, { session, children: h(Probe) }));
  await act(async () => {
    await state.refresh();
  });
  expect(state.photos).toHaveLength(1);
  return {
    pod,
    io,
    omitEtags,
    get state() {
      return state;
    },
    remount: async () => {
      await view.unmount();
      view = await mount(h(PhotosProvider, { session, children: h(Probe) }));
      await act(async () => {
        await state.refresh();
      });
    },
    intercept: (handler: typeof intercept) => {
      intercept = handler;
    },
  };
}
it("persists two keyword changes queued before the first save settles", async () => {
  const s = await setup();
  const original = s.state.photos[0];
  if (!original) throw new Error("Missing fixture");
  const started = deferred<void>();
  const release = deferred<void>();
  s.intercept(async (url, method) => {
    if (url === original.url && method === "PUT") {
      s.intercept(undefined);
      started.resolve();
      await release.promise;
    }
    return undefined;
  });
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  await act(async () => {
    first = s.state.keywords(original, ["garden"]);
    second = s.state.keywords(original, ["garden", "roses"]);
    await started.promise;
  });
  expect(s.state.photos[0]?.keywords).toEqual(["garden", "roses"]);
  await act(async () => {
    release.resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });
  expect((await s.io.loadPhoto(original.url)).photo?.keywords).toEqual(["garden", "roses"]);
});
it("retains a trash operation ID after a failed tombstone, so retry leaves one usable record", async () => {
  const s = await setup();
  const original = s.state.photos[0];
  if (!original) throw new Error("Missing fixture");
  s.intercept(async (url, method) =>
    url === original.url && method === "PUT" ? new Response(null, { status: 500 }) : undefined,
  );
  await act(async () => {
    expect(await s.state.moveToTrash([original])).toBe(false);
  });
  expect(s.state.trash).toHaveLength(1);
  const recoveryUrl = s.state.trash[0]?.url;
  s.intercept(undefined);
  await s.remount();
  await act(async () => {
    expect(await s.state.moveToTrash([original])).toBe(true);
  });
  expect(s.state.photos).toHaveLength(0);
  expect(s.state.trash.map((item) => item.url)).toEqual([recoveryUrl]);
  await act(async () => {
    expect(await s.state.restore([recoveryUrl as string])).toBe(true);
  });
  expect(s.state.photos).toHaveLength(1);
  expect(s.state.trash).toHaveLength(0);
});
it("creates an album populated with the selection when PUT supplies no ETag", async () => {
  const s = await setup();
  const refs = s.state.photos.map((photo) => photo.ref);
  s.omitEtags.add(`${s.io.root}albums/selected.ttl`);
  await act(async () => {
    expect(await s.state.newAlbum("Selected", refs)).toBe(true);
  });
  expect(s.state.albums).toHaveLength(1);
  expect(s.state.albums[0]?.members).toEqual(refs);
});
