// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { WhiteboardApp } from "@/apps/whiteboard/components/whiteboard-app";
import "@/apps/whiteboard/components/whiteboard.css";
export const metadata: Metadata = { title: "Whiteboard · Solid Suite" };
export default function Page() {
  return <WhiteboardApp />;
}
