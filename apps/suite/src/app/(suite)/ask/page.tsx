// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { AskApp } from "@/apps/ask/components/ask-app";
import "@/apps/ask/components/ask.css";

export const metadata: Metadata = { title: "Ask · Solid Suite" };

export default function Page() {
  return <AskApp />;
}
