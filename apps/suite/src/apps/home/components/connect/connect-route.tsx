// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import { usePageRouteParams } from "@/lib/route-params";
import { entries } from "./config";
import { ConnectFlow } from "./flow";

/**
 * Reads the connector id on the client, so the native export's placeholder page works too. Only
 * the placeholder has no params; an id that names no connector is a real 404.
 */
export function ConnectRoute() {
  const params = usePageRouteParams<{ service: string }>("/connect/[service]");
  if (!params) return <LoadingSkeleton preset="list" />;
  if (!entries.some((entry) => entry.id === params.service)) notFound();
  return <ConnectFlow service={params.service} />;
}
