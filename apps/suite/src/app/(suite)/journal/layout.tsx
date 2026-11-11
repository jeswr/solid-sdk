// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JournalApp } from "@/apps/journal/components/journal-app";
import "@/apps/journal/components/journal.css";
export const metadata: Metadata = { title: "Journal · Solid Suite" };
export default function JournalLayout({ children }: { children: ReactNode }) {
  return <JournalApp>{children}</JournalApp>;
}
