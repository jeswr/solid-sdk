// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { PublishApp } from "@/apps/publish/components/publish-app";

export const metadata: Metadata = { title: "Publish · Solid Suite" };

export default function Page() {
  return <PublishApp />;
}
