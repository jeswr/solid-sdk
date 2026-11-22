// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { PublicEventPage } from "@/apps/events/components/public-event";
export const metadata: Metadata = {
  title: "You're invited · Events",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <PublicEventPage />;
}
