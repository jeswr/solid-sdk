// AUTHORED-BY Codex GPT-6
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MusicApp } from "@/apps/music/components/music-app";
import "@/apps/music/components/music.css";
export const metadata: Metadata = { title: "Music · Solid Suite" };
export default function MusicLayout({ children }: { children: ReactNode }) {
  return <MusicApp>{children}</MusicApp>;
}
