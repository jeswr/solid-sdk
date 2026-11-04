// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { RequestsRoute } from "@/apps/home/components/requests/requests-route";
import "@/apps/home/components/permissions/permissions.css";
import "@/apps/home/components/requests/requests.css";

export const metadata: Metadata = { title: "Requests · Solid Suite" };

export default function Page() {
  return <RequestsRoute />;
}
