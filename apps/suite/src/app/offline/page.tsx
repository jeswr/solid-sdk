// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { OfflinePage } from "@/shell/sync/offline-page";

export const metadata: Metadata = { title: "Offline · Solid Suite" };

/** The service worker's fallback for pages that are not saved on this device. */
export default function Page() {
  return <OfflinePage />;
}
