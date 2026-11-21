// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { PlannedApp } from "@/apps/planned/planned-app";

export const metadata: Metadata = { title: "Journal · Solid Suite" };

export default function Page() {
  return <PlannedApp app="journal" />;
}
