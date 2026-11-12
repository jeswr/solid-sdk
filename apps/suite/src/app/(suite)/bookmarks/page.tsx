// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { BookmarksApp } from "@/apps/bookmarks/components/bookmarks-app";
import "@/apps/bookmarks/components/bookmarks.css";

export const metadata: Metadata = { title: "Bookmarks · Solid Suite" };

export default function Page() {
  return <BookmarksApp />;
}
