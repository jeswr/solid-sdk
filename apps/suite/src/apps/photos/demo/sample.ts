// AUTHORED-BY Codex GPT-6
import type { PodSession } from "../../../lib/session/pod-session";
import { changeMembers, coverAlbum, createAlbum, saveAlbum } from "../lib/data/albums";
import { preferenceStore, setFavourites } from "../lib/data/favourites";
import { statusOf } from "../lib/data/shared";
import { photoDataStorage } from "../lib/data/storage";
import { uploadFiles } from "../lib/data/upload";
import type { ImageEncoder } from "../lib/model";
import { scenes } from "./images";

function blob(value: string, type: string) {
  return new Blob([Uint8Array.from(atob(value), (char) => char.charCodeAt(0))], { type });
}
const running = new WeakMap<PodSession, Promise<void>>();
export function ensureSample(session: PodSession): Promise<void> {
  const existing = running.get(session);
  if (existing) return existing;
  const work = seed(session).catch((error: unknown) => {
    running.delete(session);
    throw error;
  });
  running.set(session, work);
  return work;
}
async function seed(session: PodSession) {
  if (session.mode !== "demo") return;
  const io = photoDataStorage(session.fetch, session.storageUrl);
  try {
    await io.list(io.root);
    return;
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }
  const names = [
    "Morning by the lake",
    "Garden in bloom",
    "Ghent waterfront",
    "Evening walk",
    "Quiet water",
    "First flowers",
    "Ghent rooftops",
    "Distant hills",
    "Weekend escape",
    "Autumn garden",
    "Canal reflections",
    "Last light",
  ];
  const refs: string[] = [];
  const now = Date.now();
  for (let index = 0; index < names.length; index++) {
    const scene = scenes[index % scenes.length] as readonly [string, string];
    const date = new Date(now - index * 3.5 * 86_400_000).toISOString();
    const encoder: ImageEncoder = {
      dimensions: async () => ({ width: 160, height: 100 }),
      stripLocation: async (value) => value,
      thumbnail: async () => blob(scene[1], "image/webp"),
    };
    const result = (
      await uploadFiles(
        io,
        [{ name: names[index] as string, original: blob(scene[0], "image/png") }],
        { encoder, stripLocation: false, now: date, id: () => `sample-${index + 1}` },
      )
    )[0];
    if (!result?.ok) throw new Error("Couldn't create sample photos");
    const loaded = await io.loadPhoto(result.url);
    if (loaded.photo && loaded.etag)
      await io.savePhoto(
        result.url,
        {
          ...loaded.photo,
          keywords: index % 2 ? ["garden", "weekend"] : ["travel", "water"],
          exif: {
            ...loaded.photo.exif,
            dateTimeOriginal: date,
            ...(index < 3
              ? {
                  make: "FUJIFILM",
                  model: "X-T5",
                  lensModel: "XF 23mm",
                  fNumber: 2.8,
                  iso: 200,
                  exposureTimeSec: 0.004,
                  focalLengthMm: 23,
                }
              : {}),
            ...(index === 2 ? { location: { lat: 51.0543, long: 3.7174 } } : {}),
          },
        },
        { etag: loaded.etag },
      );
    refs.push(`${result.url}#it`);
  }
  for (const [name, indices] of [
    ["Ghent trip", [2, 6, 10]],
    ["Garden", [1, 5, 9]],
  ] as const) {
    const album = await createAlbum(io, name, new Date(now).toISOString());
    const populated = changeMembers(
      album,
      indices.map((index) => refs[index] as string),
      true,
    );
    await saveAlbum(io, coverAlbum(populated, populated.members[0] as string));
  }
  await setFavourites(
    preferenceStore(session.fetch, session.storageUrl),
    [refs[0] as string, refs[2] as string],
    true,
  );
}
