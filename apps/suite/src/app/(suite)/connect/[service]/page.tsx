// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { Suspense } from "react";
import { entries } from "@/apps/home/components/connect/config";
import { ConnectRoute } from "@/apps/home/components/connect/connect-route";
import "@/apps/home/components/connect/connect.css";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
/** The native export ships one placeholder page; the web prerenders every known connector. */
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native"
    ? [{ service: "__" }]
    : entries.map((entry) => ({ service: entry.id }));
}

export default function Page() {
  return (
    <Suspense>
      <ConnectRoute />
    </Suspense>
  );
}
