// AUTHORED-BY Claude Opus 5.5
import type { CaptureMetadata } from "../model";

/** One file from a chosen Takeout folder; `path` is its folder-relative path. */
export interface TakeoutEntry {
  path: string;
  file: Blob;
}
export interface TakeoutItem {
  /** Stable within one plan; albums refer to items by it. */
  key: string;
  name: string;
  path: string;
  /** The image, typed from its extension when the browser gave no type. */
  file: Blob;
  metadata?: CaptureMetadata | undefined;
}
export interface TakeoutAlbum {
  title: string;
  keys: string[];
}
export interface TakeoutPlan {
  items: TakeoutItem[];
  albums: TakeoutAlbum[];
  /** Photos whose date, place or caption came from a Takeout sidecar. */
  withDetails: number;
  /** Videos are not supported by Photos yet. */
  videos: number;
  /** Files that are neither photos, videos nor Takeout metadata. */
  unsupported: number;
  /** The same photo (name and size) found again: Takeout copies album photos into year folders. */
  duplicates: number;
  /** Photos in Takeout's Trash or Bin folder, which were deleted in Google Photos. */
  trashed: number;
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  avif: "image/avif",
};
const VIDEO = /\.(mp4|m4v|mov|3gp|webm|avi|mkv|mpg|mpeg|wmv)$/iu;
const SUPPLEMENTAL = ".supplemental-metadata";
/** Google shortens long sidecar names to about 47–51 characters. */
const TRUNCATED_NAME_LENGTH = 46;
const MAX_SIDECAR_BYTES = 1024 * 1024;
const NOT_ALBUMS = /^(Photos from \d{4}|Trash|Bin|Archive)$/u;
/** Deleted photos: not imported. */
const TRASH = /^(Trash|Bin)$/u;

const extension = (name: string) => /\.([^.]+)$/u.exec(name)?.[1]?.toLowerCase() ?? "";
const splitPath = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  return { folder: parts.slice(0, -1).join("/"), name: parts.at(-1) ?? "" };
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The wall-clock time of `date` in `timeZone`, written as if it were UTC. Photo
 * EXIF dates carry no zone and are stored this way, so sidecar dates (real
 * instants) are converted to match and sort alongside them.
 */
export function wallClock(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`;
}

/**
 * Reads a photo sidecar; returns undefined for any other JSON. The date is the
 * wall-clock time in `timeZone` (the importing device's zone), like EXIF dates.
 */
export function parseSidecar(
  text: string,
  timeZone = "UTC",
): { title?: string; metadata: CaptureMetadata } | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || !isRecord(raw.photoTakenTime)) return undefined;
  const metadata: CaptureMetadata = {};
  const seconds = Number(raw.photoTakenTime.timestamp);
  if (Number.isSafeInteger(seconds) && seconds > 0)
    metadata.dateTimeOriginal = wallClock(new Date(seconds * 1000), timeZone);
  for (const key of ["geoData", "geoDataExif"]) {
    const geo = raw[key];
    if (metadata.location || !isRecord(geo)) continue;
    const lat = Number(geo.latitude);
    const long = Number(geo.longitude);
    // Takeout writes 0,0 when it has no location.
    if (Number.isFinite(lat) && Number.isFinite(long) && (lat !== 0 || long !== 0))
      metadata.location = { lat, long };
  }
  if (typeof raw.description === "string" && raw.description.trim())
    metadata.description = raw.description.trim();
  return {
    ...(typeof raw.title === "string" && raw.title ? { title: raw.title } : {}),
    metadata,
  };
}

/** The media name a sidecar file name points at, plus a duplicate index like "(1)". */
export function sidecarTarget(name: string): { base: string; index: string } {
  let base = name.replace(/\.json$/iu, "");
  let index = "";
  const numbered = /^(.*)(\(\d+\))$/u.exec(base);
  if (numbered) {
    base = numbered[1] as string;
    index = numbered[2] as string;
  }
  for (let length = SUPPLEMENTAL.length; length >= 2; length--)
    if (base.endsWith(SUPPLEMENTAL.slice(0, length))) {
      base = base.slice(0, -length);
      break;
    }
  return { base, index };
}

/**
 * The names a media file's sidecar may use: its whole name (a file already
 * called "image (1).jpg"), the name without Takeout's duplicate index, and the
 * original of an edited copy.
 */
function mediaTargets(name: string): { base: string; index: string; exact?: boolean }[] {
  // Media names always carry an image extension, so this always matches.
  const match = /^(.*?)(\(\d+\))?(\.[^.]+)$/u.exec(name) as RegExpExecArray;
  const stem = match[1] as string;
  const index = match[2] ?? "";
  const ext = match[3] as string;
  // The whole name is tried only as an exact match: as a prefix it would also
  // match the original's shortened sidecar.
  const targets: { base: string; index: string; exact?: boolean }[] = index
    ? [{ base: name, index: "", exact: true }]
    : [];
  targets.push({ base: `${stem}${ext}`, index });
  if (/-edited$/iu.test(stem)) targets.push({ base: `${stem.slice(0, -7)}${ext}`, index });
  return targets;
}

export interface PlanOptions {
  /** The IANA zone sidecar dates are converted into (default UTC). */
  timeZone?: string;
}

/**
 * Pairs Takeout photos with their JSON sidecars and album folders. Photos found in
 * more than one folder (an album and its year folder) become one item in every album.
 */
export async function planTakeout(
  entries: readonly TakeoutEntry[],
  { timeZone = "UTC" }: PlanOptions = {},
): Promise<TakeoutPlan> {
  const folders = new Map<string, { media: TakeoutEntry[]; json: TakeoutEntry[] }>();
  let videos = 0;
  let unsupported = 0;
  let trashed = 0;
  for (const entry of entries) {
    const { folder, name } = splitPath(entry.path);
    if (TRASH.test(folder.split("/").at(-1) as string)) {
      if (IMAGE_TYPES[extension(name)] || VIDEO.test(name)) trashed += 1;
      continue;
    }
    const group = folders.get(folder) ?? { media: [], json: [] };
    folders.set(folder, group);
    if (/\.json$/iu.test(name)) group.json.push(entry);
    else if (IMAGE_TYPES[extension(name)]) group.media.push(entry);
    else if (VIDEO.test(name)) videos += 1;
    else unsupported += 1;
  }
  const items = new Map<string, TakeoutItem>();
  const albums = new Map<string, { title: string; keys: Set<string> }>();
  let withDetails = 0;
  let duplicates = 0;
  for (const [folder, group] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
    const sidecars = new Map<string, CaptureMetadata>();
    const truncated: { base: string; index: string; metadata: CaptureMetadata }[] = [];
    let albumTitle: string | undefined;
    for (const entry of group.json) {
      if (entry.file.size > MAX_SIDECAR_BYTES) continue;
      const { name } = splitPath(entry.path);
      const text = await entry.file.text();
      if (name === "metadata.json") {
        try {
          const raw: unknown = JSON.parse(text);
          if (isRecord(raw) && typeof raw.title === "string" && raw.title.trim())
            albumTitle = raw.title.trim();
        } catch {
          // Not album metadata; the folder simply isn't treated as an album.
        }
        continue;
      }
      const sidecar = parseSidecar(text, timeZone);
      if (!sidecar) continue;
      const target = sidecarTarget(name);
      sidecars.set(`${target.base}\u0000${target.index}`, sidecar.metadata);
      if (name.length >= TRUNCATED_NAME_LENGTH) truncated.push({ ...target, ...sidecar });
    }
    const folderName = folder.split("/").at(-1) as string;
    const album =
      albumTitle && !NOT_ALBUMS.test(folderName)
        ? (albums.get(albumTitle) ?? { title: albumTitle, keys: new Set<string>() })
        : undefined;
    if (album) albums.set(album.title, album);
    for (const entry of group.media) {
      const { name } = splitPath(entry.path);
      let metadata: CaptureMetadata | undefined;
      for (const target of mediaTargets(name)) {
        metadata ??= sidecars.get(`${target.base}\u0000${target.index}`);
        if (target.exact) continue;
        metadata ??= truncated
          .filter(
            (candidate) =>
              candidate.index === target.index && target.base.startsWith(candidate.base),
          )
          .sort((a, b) => b.base.length - a.base.length)[0]?.metadata;
      }
      const key = `${name}\u0000${entry.file.size}`;
      const known = items.get(key);
      const detailed = (value: CaptureMetadata | undefined) =>
        value !== undefined && Object.keys(value).length > 0;
      if (known) {
        duplicates += 1;
        // Album copies sometimes lack the sidecar their year-folder twin has.
        if (!detailed(known.metadata) && detailed(metadata)) {
          known.metadata = metadata;
          withDetails += 1;
        }
      } else {
        const type = entry.file.type || (IMAGE_TYPES[extension(name)] as string);
        items.set(key, {
          key,
          name,
          path: entry.path,
          file: entry.file.type ? entry.file : entry.file.slice(0, entry.file.size, type),
          metadata,
        });
        if (detailed(metadata)) withDetails += 1;
      }
      album?.keys.add(key);
    }
  }
  return {
    items: [...items.values()],
    albums: [...albums.values()]
      .filter((album) => album.keys.size)
      .map((album) => ({ title: album.title, keys: [...album.keys] })),
    withDetails,
    videos,
    unsupported,
    duplicates,
    trashed,
  };
}
