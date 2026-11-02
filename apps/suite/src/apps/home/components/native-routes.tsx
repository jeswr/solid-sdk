// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import { usePageRouteParams } from "@/lib/route-params";
import { DOMAINS, UNCATEGORISED } from "../lib/model/domains";
import { HomePage } from "./home-page";
import { PermissionAgentPage } from "./permissions/agent-page";

/** Reads the domain on the client, so the native export's placeholder page works too. */
export function HomeDomainRoute() {
  const params = usePageRouteParams<{ domain: string }>("/home/[domain]");
  if (!params) return <LoadingSkeleton preset="grid" />;
  const id = params.domain;
  if (id !== UNCATEGORISED.id && !DOMAINS.some((entry) => entry.id === id)) notFound();
  return <HomePage domain={id} />;
}

/** Reads the agent ref on the client, so the native export's placeholder page works too. */
export function PermissionAgentRoute() {
  const params = usePageRouteParams<{ agentRef: string }>("/permissions/a/[agentRef]");
  if (!params) return <LoadingSkeleton preset="detail" />;
  return <PermissionAgentPage agentRef={params.agentRef} />;
}
