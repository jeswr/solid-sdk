// AUTHORED-BY Codex GPT-6.1-Sol
import { Play } from "lucide-react";
import type { Photo } from "../lib/model";

export function videoDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "Duration unknown";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
export function mediaLabel(photo: Photo): string {
  return photo.kind === "video"
    ? `${photo.name}, video, ${videoDuration(photo.durationSeconds)}`
    : photo.name;
}
export function VideoBadge({ photo }: { photo: Photo }) {
  if (photo.kind !== "video") return null;
  return (
    <span className="pho-video-badge" aria-hidden="true">
      <Play size={14} fill="currentColor" />
      {photo.durationSeconds !== undefined && <span>{videoDuration(photo.durationSeconds)}</span>}
    </span>
  );
}
