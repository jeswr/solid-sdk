// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { HistoryRoute } from "@/apps/home/components/permissions/history-route";
import "@/apps/home/components/permissions/permissions.css";
import "@/apps/home/components/requests/requests.css";

export const metadata: Metadata = { title: "History · Solid Suite" };

export default function Page() {
  return <HistoryRoute />;
}
