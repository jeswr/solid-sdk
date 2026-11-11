// AUTHORED-BY Codex GPT-6.1-Sol
export interface MediaEntry {
  id: string;
  title: string;
  summary: string;
  file?: string | undefined;
  captions?: string | undefined;
  duration?: number | undefined;
}
export interface MediaManifest {
  videos: { tour?: MediaEntry | undefined; feedback?: MediaEntry | undefined };
  clips: MediaEntry[];
}
export const emptyManifest: MediaManifest = { videos: {}, clips: [] };

// Only local media filenames are admitted from the release manifest.
const filename = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) ? value : undefined;
function entry(value: unknown): MediaEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.id) ||
    typeof v.title !== "string" ||
    typeof v.summary !== "string"
  )
    return undefined;
  return {
    id: v.id,
    title: v.title,
    summary: v.summary,
    file: filename(v.file),
    captions: filename(v.captions),
    duration:
      typeof v.duration === "number" && Number.isFinite(v.duration) && v.duration > 0
        ? v.duration
        : undefined,
  };
}
export function parseManifest(value: unknown): MediaManifest {
  if (!value || typeof value !== "object") return emptyManifest;
  const v = value as Record<string, unknown>;
  const videos =
    v.videos && typeof v.videos === "object" ? (v.videos as Record<string, unknown>) : {};
  const ids = new Set<string>();
  const clips = (Array.isArray(v.clips) ? v.clips : []).flatMap((candidate) => {
    const clip = entry(candidate);
    if (!clip?.file || ids.has(clip.id)) return [];
    ids.add(clip.id);
    return [clip];
  });
  return { videos: { tour: entry(videos.tour), feedback: entry(videos.feedback) }, clips };
}
export const mediaUrl = (file: string) => `/media/${file}`;
export const durationLabel = (seconds: number) =>
  seconds < 90
    ? `${Math.max(1, Math.round(seconds))} seconds`
    : `${Math.round(seconds / 60)} minutes`;
