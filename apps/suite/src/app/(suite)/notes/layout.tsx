// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { NotesApp } from "@/apps/notes/components/notes-app";
import "@/apps/notes/components/notes.css";

export const metadata: Metadata = { title: "Notes · Solid Suite" };
export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div role="status">Opening your Notes…</div>}>
      <NotesApp>{children}</NotesApp>
    </Suspense>
  );
}
