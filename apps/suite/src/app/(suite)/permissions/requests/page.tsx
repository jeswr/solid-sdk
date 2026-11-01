// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RequestsPage } from "@/apps/home/components/requests/requests-page";
import { requestCaps } from "@/apps/home/lib/requests/caps";
import { suiteEnv } from "@/shell/lib/env";
import "@/apps/home/components/permissions/permissions.css";
import "@/apps/home/components/requests/requests.css";

export const metadata: Metadata = { title: "Requests · Solid Suite" };

export default function Page() {
  // Without access requests there is no inbox to show (03-home-permissions §6).
  if (!requestCaps(suiteEnv().SUITE_TEST_CAPS, process.env.NEXT_PUBLIC_SUITE_CAPS).accessRequests)
    redirect("/permissions");
  return <RequestsPage />;
}
