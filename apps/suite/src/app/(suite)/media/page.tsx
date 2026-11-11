// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { MediaApp } from "@/apps/media/components/media-app";
import "@/apps/media/components/media.css";
export const metadata: Metadata = { title: "Media · Solid Suite" };
export default function Page() {
  return <MediaApp />;
}
