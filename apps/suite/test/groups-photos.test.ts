// AUTHORED-BY Claude Opus 5.5

import { readGrants } from "@jeswr/pod-access/roles";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { GroupDirectory } from "@jeswr/suite-groups";
import { toast } from "@jeswr/suite-ui";
import { expect, it, vi } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { photoResources, shareAddedPhotos } from "../src/apps/photos/lib/data/album-groups";
import { changeMembers } from "../src/apps/photos/lib/data/albums";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import { PhotosProvider, usePhotos } from "../src/apps/photos/state/photos-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { familySpaces } from "../src/shell/groups/family-spaces";
import { act, h, mount } from "./drive-ui-dom";

const messages = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: Object.assign(vi.fn(), messages) }));
const NOW = "2026-11-01T12:00:00Z";
const bob = "https://bob.example.org/#me";

async function setup() {
  vi.mocked(toast).mockClear();
  for (const message of Object.values(messages)) message.mockReset();
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: "Me",
    fetch: pod.fetch,
    subscribe: () => () => {},
    reset: async () => {},
  };
  const { storage } = await createPodClient({
    storage: DEMO_ROOT,
    fetch: pod.fetch,
    capabilities: createMemoryCache(),
  });
  const directory = new GroupDirectory(
    { storage, fetch: pod.fetch, webId: DEMO_WEBID },
    vi.fn().mockResolvedValue({ delivered: true, inbox: null }),
  );
  const io = photoDataStorage(pod.fetch, DEMO_ROOT);
  let id = 0;
  const upload = async () => {
    const [result] = await uploadFiles(
      io,
      [
        {
          name: "family.png",
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
        id: () => `family-photo-${++id}`,
        now: NOW,
      },
    );
    if (!result?.ok) throw new Error("Upload failed");
    return `${result.url}#it`;
  };
  return { pod, session, storage, directory, io, upload };
}
const groupGrant = async (fetch: typeof globalThis.fetch, url: string) =>
  (await readGrants(url, { fetch, root: DEMO_ROOT, model: "wac" })).grants.filter(
    (grant) => grant.agent.type === "group",
  );

it("lets Family members read a photo added to the Family album after setup", async () => {
  const { pod, session, storage, directory, io, upload } = await setup();
  const group = await directory.create("Family Photos", [bob]);
  await directory.setupFamily(group.id, familySpaces(session, ["photos"], "viewer"));
  const state = JSON.parse(
    await (await storage.read(`${DEMO_ROOT}settings/group-sharing/state.json`)).text(),
  );
  // Only the album: no unused folder is shared.
  const [album, ...rest] = state.spaces[JSON.stringify([group.id, "photos"])];
  expect(rest).toEqual([]);
  expect(await groupGrant(pod.fetch, album)).toEqual([
    expect.objectContaining({ agent: { type: "group", id: group.id }, role: "viewer" }),
  ]);
  const ref = await upload();
  const item = ref.split("#")[0] as string;
  const backing = [
    item,
    `${io.root}originals/family-photo-1.png`,
    `${io.root}thumbs/family-photo-1.webp`,
  ];
  // Before it is added the photo is private.
  for (const url of backing) expect(await groupGrant(pod.fetch, url)).toEqual([]);
  let photos!: ReturnType<typeof usePhotos>;
  function Probe() {
    photos = usePhotos();
    return null;
  }
  await mount(h(PhotosProvider, { session, children: h(Probe) }));
  await act(async () => {
    await photos.refresh();
  });
  await act(async () => {
    expect(await photos.editAlbum(album, (value) => changeMembers(value, [ref], true))).toBe(true);
  });
  // The member can now read the photo's document, original and thumbnail through the group.
  for (const url of backing)
    expect(await groupGrant(pod.fetch, url)).toEqual([
      expect.objectContaining({ agent: { type: "group", id: group.id }, role: "viewer" }),
    ]);
  expect(messages.warning).not.toHaveBeenCalled();
  expect(messages.error).not.toHaveBeenCalled();
});

it("shares nothing for unshared albums and skips photos outside the library", async () => {
  const { pod, directory, io, upload } = await setup();
  const ref = await upload();
  const { createAlbum } = await import("../src/apps/photos/lib/data/albums");
  const album = await createAlbum(io, "Private", NOW);
  expect(await shareAddedPhotos(directory, io, album.url, [ref])).toEqual([]);
  expect(await groupGrant(pod.fetch, ref.split("#")[0] as string)).toEqual([]);
  expect(
    await photoResources(io, [
      "https://photos.example/elsewhere.ttl#it",
      `${io.root}items/x.ttl?q#it`,
      `${io.root}albums/private.ttl#it`,
    ]),
  ).toEqual([]);
  expect(await shareAddedPhotos(directory, io, album.url, [])).toEqual([]);
});

it("warns, keeping the album edit, when the album's groups cannot be extended", async () => {
  const { session, directory, io, upload } = await setup();
  const group = await directory.create("Family Photos", [bob]);
  await directory.setupFamily(group.id, familySpaces(session, ["photos"], "viewer"));
  const ref = await upload();
  const albums = (await io.list(`${io.root}albums/`)).filter((url) => url.includes("family"));
  const album = albums[0] as string;
  const failing: PodSession = {
    ...session,
    fetch: async (input, init) =>
      String(input).endsWith(".acl") && init?.method === "PUT"
        ? new Response(null, { status: 500 })
        : session.fetch(input, init),
  };
  let photos!: ReturnType<typeof usePhotos>;
  function Probe() {
    photos = usePhotos();
    return null;
  }
  await mount(h(PhotosProvider, { session: failing, children: h(Probe) }));
  await act(async () => {
    await photos.refresh();
  });
  await act(async () => {
    expect(await photos.editAlbum(album, (value) => changeMembers(value, [ref], true))).toBe(true);
  });
  expect(messages.warning).toHaveBeenCalledWith(expect.stringContaining("may not see them yet"));
});
