// AUTHORED-BY Codex GPT-6

import { toast } from "@jeswr/suite-ui";
import { expect, it, vi } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { browserEncoder } from "../src/apps/photos/lib/browser/encoder";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import { PhotosProvider, usePhotos } from "../src/apps/photos/state/photos-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";
import { animatedPng } from "./photos/animated-png";

const messages = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: Object.assign(vi.fn(), messages) }));
const ROOT = "https://state.demo.pod/";
const NOW = "2026-11-01T12:00:00Z";
async function setup(count = 1) {
  vi.mocked(toast).mockClear();
  messages.error.mockReset();
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
  let id = 0;
  await uploadFiles(
    io,
    Array.from({ length: count }, (_, index) => ({
      name: `${index + 1}.png`,
      original: new Blob([Uint8Array.from(atob(scenes[0][0]), (c) => c.charCodeAt(0))], {
        type: "image/png",
      }),
    })),
    {
      encoder: {
        dimensions: async () => ({ width: 160, height: 100 }),
        stripLocation: async (v) => v,
        thumbnail: async () => new Blob(["thumb"], { type: "image/webp" }),
      },
      stripLocation: false,
      id: () => `photo-${++id}`,
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
  expect(state.photos).toHaveLength(count);
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
it("explains how to keep animation when an animated PNG cannot be stripped", async () => {
  const s = await setup();
  const reported = deferred<void>();
  messages.error.mockImplementation(() => reported.resolve());
  const dimensions = vi
    .spyOn(browserEncoder, "dimensions")
    .mockResolvedValue({ width: 1, height: 1 });
  try {
    await act(async () => {
      s.state.upload([new File([animatedPng()], "animation.png", { type: "image/png" })], true);
      await reported.promise;
    });
    expect(messages.error).toHaveBeenCalledWith(
      expect.stringContaining("Turn off Remove location from uploads to keep all frames"),
    );
    expect(s.state.uploads).toMatchObject([{ name: "animation.png", status: "failed" }]);
    expect(s.state.photos).toHaveLength(1);
    expect(await s.io.list(`${s.io.root}originals/`)).toHaveLength(1);
  } finally {
    dimensions.mockRestore();
  }
});
it("reports a failure on the second bulk trash photo and offers Undo for every successful move", async () => {
  const s = await setup(3);
  const originals = [...s.state.photos];
  const second = originals[1];
  if (!second) throw new Error("Missing fixture");
  // Fail before the second photo's trash copy commits, isolating the partial batch.
  let copies = 0;
  s.intercept(async (url, method) =>
    method === "PUT" &&
    url.startsWith(`${s.io.root}.trash/`) &&
    url.endsWith(".ttl") &&
    ++copies === 2
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await act(async () => {
    expect(await s.state.moveToTrash(originals)).toBe(false);
  });
  expect(s.state.photos.map((photo) => photo.ref)).toEqual([second.ref]);
  expect(s.state.trash).toHaveLength(2);
  expect(messages.error).toHaveBeenCalledWith(
    "1 photo couldn't be moved to trash. Please try again.",
  );
  expect(toast).toHaveBeenCalledWith(
    "Moved 2 of 3 photos to trash",
    expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
  );
  const options = vi
    .mocked(toast)
    .mock.calls.find(([message]) => message === "Moved 2 of 3 photos to trash")?.[1];
  const undo = options?.action;
  if (!undo || typeof undo !== "object" || !("onClick" in undo)) throw new Error("Missing Undo");
  await act(async () => {
    await undo.onClick(new MouseEvent("click") as never);
  });
  expect(s.state.photos).toHaveLength(3);
  expect(s.state.trash).toHaveLength(0);
  await s.remount();
  expect(s.state.photos).toHaveLength(3);
});
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

it.each([
  false,
  true,
])("deletes after delayed queued renames using this client's latest revision (missing PUT ETag: %s)", async (missingEtag) => {
  const s = await setup();
  await act(async () => {
    await s.state.newAlbum("Before");
  });
  const album = s.state.albums[0];
  if (!album) throw new Error("Missing fixture");
  if (missingEtag) s.omitEtags.add(album.url);
  const started = deferred<void>();
  const release = deferred<void>();
  s.intercept(async (url, method) => {
    if (url === album.url && method === "PUT") {
      s.intercept(undefined);
      started.resolve();
      await release.promise;
    }
    return undefined;
  });
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  let removed!: Promise<boolean>;
  await act(async () => {
    first = s.state.editAlbum(album.url, (value) => ({ ...value, name: "Renamed" }));
    second = s.state.editAlbum(album.url, (value) => ({ ...value, name: "Renamed again" }));
    await started.promise;
  });
  expect(s.state.albums[0]?.name).toBe("Renamed again");
  await act(async () => {
    removed = s.state.removeAlbum(s.state.albums[0] as typeof album);
  });
  expect(s.state.albums).toHaveLength(0);
  await act(async () => {
    release.resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await removed).toBe(true);
  });
  expect(messages.error).not.toHaveBeenCalled();
  expect((await s.pod.fetch(album.url)).status).toBe(404);
  expect(s.state.albums).toHaveLength(0);
});
