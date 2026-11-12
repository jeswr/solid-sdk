// AUTHORED-BY Claude Opus 5.5

import { readGrants } from "@jeswr/pod-access/roles";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { GroupDirectory } from "@jeswr/suite-groups";
import { toast } from "@jeswr/suite-ui";
import { expect, it, vi } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { photoResources, shareAddedPhotos } from "../src/apps/photos/lib/data/album-groups";
import { changeMembers, createAlbumWriter } from "../src/apps/photos/lib/data/albums";
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

it("never extends a member someone else added to the album between load and save", async () => {
  const { pod, session, storage, directory, io, upload } = await setup();
  const group = await directory.create("Family Photos", [bob]);
  await directory.setupFamily(group.id, familySpaces(session, ["photos"], "editor"));
  const state = JSON.parse(
    await (await storage.read(`${DEMO_ROOT}settings/group-sharing/state.json`)).text(),
  );
  const [album] = state.spaces[JSON.stringify([group.id, "photos"])];
  const chosen = await upload();
  const secret = await upload();
  let photos!: ReturnType<typeof usePhotos>;
  function Probe() {
    photos = usePhotos();
    return null;
  }
  await mount(h(PhotosProvider, { session, children: h(Probe) }));
  await act(async () => {
    await photos.refresh();
  });
  // A group Editor adds a ref to the owner's private photo after the owner loaded the album.
  await createAlbumWriter(io).edit(album, (value) => changeMembers(value, [secret], true));
  await act(async () => {
    expect(await photos.editAlbum(album, (value) => changeMembers(value, [chosen], true))).toBe(
      true,
    );
  });
  const files = (ref: string) => {
    const id = (ref.split("/").at(-1) as string).replace(".ttl#it", "");
    return [
      ref.split("#")[0] as string,
      `${io.root}originals/${id}.png`,
      `${io.root}thumbs/${id}.webp`,
    ];
  };
  for (const url of files(chosen))
    expect(await groupGrant(pod.fetch, url)).toEqual([
      expect.objectContaining({ agent: { type: "group", id: group.id }, role: "viewer" }),
    ]);
  // The remote member stays in the album, but its photo stays private.
  expect((await io.loadAlbum(album)).album?.members).toEqual(
    expect.arrayContaining([chosen, secret]),
  );
  for (const url of files(secret)) expect(await groupGrant(pod.fetch, url)).toEqual([]);
});

it("only counts binaries in the library's originals/ and thumbs/ folders", async () => {
  const { io, upload } = await setup();
  const ref = await upload();
  const { photo } = await io.loadPhoto(ref.split("#")[0] as string);
  if (!photo) throw new Error("Missing photo");
  const evil = `${io.root}items/evil.ttl`;
  // An item document naming other pod documents as its binaries.
  await io.savePhoto(
    evil,
    { ...photo, contentUrl: `${DEMO_ROOT}drive/notes.md`, thumbnailUrl: `${io.root}albums/x.ttl` },
    { create: true },
  );
  expect(await photoResources(io, [`${evil}#it`])).toEqual([evil]);
  const nested = `${io.root}items/nested.ttl`;
  await io.savePhoto(
    nested,
    {
      ...photo,
      contentUrl: `${io.root}originals/a/b.png`,
      thumbnailUrl: `${io.root}thumbs/x.webp?v=1`,
    },
    { create: true },
  );
  expect(await photoResources(io, [`${nested}#it`])).toEqual([nested]);
  // Traversal out of originals/ and thumbs/ is refused, even when it would resolve elsewhere.
  for (const [name, contentUrl, thumbnailUrl] of [
    ["up", `${io.root}originals/../../journal/secret.ttl`, `${io.root}thumbs/../items/x.ttl`],
    ["photos-up", `${io.root}../journal/secret.ttl`, `${io.root}originals/%2e%2e/x.png`],
    ["photos-other", `${io.root}items/other.ttl`, `${io.root}trash/x.webp`],
  ] as const) {
    const item = `${io.root}items/${name}.ttl`;
    await io.savePhoto(item, { ...photo, contentUrl, thumbnailUrl }, { create: true });
    expect((await io.loadPhoto(item)).photo?.contentUrl).toBe(contentUrl);
    expect(await photoResources(io, [`${item}#it`])).toEqual([item]);
  }
  // The library's own binaries still count.
  expect(await photoResources(io, [ref])).toEqual([
    ref.split("#")[0],
    photo.contentUrl,
    photo.thumbnailUrl,
  ]);
});

it("counts only the item's own original and thumbnail; one bad entry never blocks the rest", async () => {
  const { pod, session, storage, directory, io, upload } = await setup();
  const group = await directory.create("Family Photos", [bob]);
  await directory.setupFamily(group.id, familySpaces(session, ["photos"], "editor"));
  const state = JSON.parse(
    await (await storage.read(`${DEMO_ROOT}settings/group-sharing/state.json`)).text(),
  );
  const [album] = state.spaces[JSON.stringify([group.id, "photos"])];
  const shared = await upload();
  const secret = await upload();
  const sharedItem = shared.split("#")[0] as string;
  const { photo } = await io.loadPhoto(sharedItem);
  if (!photo) throw new Error("Missing photo");
  // A group Editor of the shared photo points its binaries at the owner's private photo.
  const secretId = (secret.split("/").at(-1) as string).replace(".ttl#it", "");
  const secretFiles = [`${io.root}originals/${secretId}.png`, `${io.root}thumbs/${secretId}.webp`];
  const hijacked = `${io.root}items/hijacked.ttl`;
  await io.savePhoto(
    hijacked,
    { ...photo, contentUrl: secretFiles[0] as string, thumbnailUrl: secretFiles[1] as string },
    { create: true },
  );
  expect(await photoResources(io, [`${hijacked}#it`])).toEqual([hijacked]);
  // Encoded names pass a folder check but no pod's grant check: they are skipped, not fatal.
  const encoded = `${io.root}items/encoded.ttl`;
  await io.savePhoto(
    encoded,
    {
      ...photo,
      contentUrl: `${io.root}originals/..%2F..%2Fx`,
      thumbnailUrl: `${io.root}thumbs/..%2Fx.webp`,
    },
    { create: true },
  );
  expect(await photoResources(io, [`${encoded}#it`])).toEqual([encoded]);
  expect(
    await photoResources(io, [`${io.root}items/a%2Fb.ttl#it`, `${io.root}items/.ttl#it`]),
  ).toEqual([]);
  // Sharing them together with a good photo still shares the good photo.
  expect(
    await shareAddedPhotos(directory, io, album, [
      `${io.root}items/a%2Fb.ttl#it`,
      `${encoded}#it`,
      `${hijacked}#it`,
      shared,
    ]),
  ).toEqual([group.id]);
  for (const url of [sharedItem, photo.contentUrl, photo.thumbnailUrl as string])
    expect(await groupGrant(pod.fetch, url)).toEqual([
      expect.objectContaining({ agent: { type: "group", id: group.id }, role: "viewer" }),
    ]);
  for (const url of [secret.split("#")[0] as string, ...secretFiles])
    expect(await groupGrant(pod.fetch, url)).toEqual([]);
});
