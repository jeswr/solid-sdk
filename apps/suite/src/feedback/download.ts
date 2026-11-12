// AUTHORED-BY Codex GPT-6.1-Sol
import { strToU8, zipSync } from "fflate";
import { saveBlob } from "@/lib/native/save-file";
import { renderMarkdown } from "./markdown";
import type { VoiceClip } from "./speech";
import type { Submission } from "./validation";
export async function feedbackArchive(
  submission: Submission,
  clips: VoiceClip[],
): Promise<Uint8Array> {
  const names = clips.map(
    (c, i) =>
      `audio-${i + 1}.${c.blob.type.includes("mp4") ? "m4a" : c.blob.type.includes("ogg") ? "ogg" : "webm"}`,
  );
  const files: Record<string, Uint8Array> = {
    "submission.json": strToU8(JSON.stringify(submission, null, 2)),
    "feedback.md": strToU8(renderMarkdown(submission, names)),
  };
  for (const [i, clip] of clips.entries())
    files[names[i] ?? `audio-${i + 1}.webm`] = new Uint8Array(await clip.blob.arrayBuffer());
  return zipSync(files, { level: 0 });
}

/** Native WebViews need the platform save sheet; blob download navigation is blocked. */
export async function saveFeedbackArchive(bytes: Uint8Array): Promise<boolean> {
  const name = "solid-suite-feedback.zip";
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" });
  return saveBlob(blob, name, "application/zip");
}
