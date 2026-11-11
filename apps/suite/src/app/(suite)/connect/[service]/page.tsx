// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { entries } from "@/apps/home/components/connect/config";
import { ConnectRoute } from "@/apps/home/components/connect/connect-route";
import "@/apps/home/components/connect/connect.css";

// Reject unknown services before the shell's Suspense boundaries stream a 200 response.
export const dynamicParams = false;
/** The native export ships one placeholder page; the web prerenders every known connector. */
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native"
    ? [{ service: "__" }]
    : entries.map((entry) => ({ service: entry.id }));
}

export default async function Page({ params }: { params: Promise<{ service: string }> }) {
  const { service } = await params;
  if (
    process.env.NEXT_PUBLIC_SUITE_TARGET !== "native" &&
    !entries.some((entry) => entry.id === service)
  )
    notFound();
  return (
    <Suspense>
      <ConnectRoute />
    </Suspense>
  );
}
