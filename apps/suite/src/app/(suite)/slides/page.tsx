// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { SlidesApp } from "@/apps/slides/components/slides-app";
import "@/apps/slides/components/slides.css";
export const metadata: Metadata = { title: "Slides · Solid Suite" };
export default function Page() {
  return <SlidesApp />;
}
