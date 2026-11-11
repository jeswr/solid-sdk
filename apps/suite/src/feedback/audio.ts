// AUTHORED-BY Codex GPT-6.1-Sol
import { FeedbackError } from "./security";
export interface AudioFile {
  bytes: Uint8Array;
  ext: "webm" | "ogg" | "m4a";
  type: string;
}
export function sniffAudio(bytes: Uint8Array): AudioFile["ext"] | undefined {
  if (bytes.length < 12) return undefined;
  const ascii = (from: number, to: number) => new TextDecoder().decode(bytes.slice(from, to));
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "webm";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (
    ascii(4, 8) === "ftyp" &&
    /^(M4A |M4B |isom|iso[2-9]|mp4[12]|MSNV|qt {2})$/.test(ascii(8, 12))
  )
    return "m4a";
  return undefined;
}
export async function validateAudio(file: File): Promise<AudioFile> {
  if (!file.type.startsWith("audio/") || file.size === 0 || file.size > 4 * 1024 * 1024)
    throw new FeedbackError(400, "Each recording must be an audio file of at most 4 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffAudio(bytes);
  const mime = (file.type.split(";")[0] ?? "").toLowerCase();
  const expected = ext === "webm" ? "audio/webm" : ext === "ogg" ? "audio/ogg" : "audio/mp4";
  if (!ext || (mime !== expected && !(ext === "m4a" && mime === "audio/x-m4a")))
    throw new FeedbackError(400, "Use a WebM, Ogg or MP4 audio recording.");
  return { bytes, ext, type: expected };
}
