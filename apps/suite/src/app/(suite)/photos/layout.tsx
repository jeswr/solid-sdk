// AUTHORED-BY Codex GPT-6
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PhotosApp } from "@/apps/photos/components/photos-app";
import "@/apps/photos/components/photos.css";
export const metadata: Metadata = { title: "Photos · Solid Suite" };
export default function PhotosLayout({ children }: { children: ReactNode }) {
  return <PhotosApp>{children}</PhotosApp>;
}
