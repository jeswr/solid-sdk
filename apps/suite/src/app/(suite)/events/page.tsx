// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { EventsApp } from "@/apps/events/components/events-app";
export const metadata: Metadata = { title: "Events · Solid Suite" };
export default function Page() {
  return <EventsApp />;
}
