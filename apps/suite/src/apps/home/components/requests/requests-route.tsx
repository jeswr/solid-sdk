// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useRequestCaps } from "../../state/requests";
import { RequestsPage } from "./requests-page";

/**
 * Decides on the client whether access requests exist, so the pages behind it stay statically
 * exportable for the native build. Without access requests there is no inbox or history to show
 * (03-home-permissions §6), so the route returns to Permissions.
 */
export function AccessRequestsGate({ children }: { children: ReactNode }) {
  const { accessRequests } = useRequestCaps();
  const router = useRouter();
  useEffect(() => {
    if (!accessRequests) router.replace("/permissions");
  }, [accessRequests, router]);
  return accessRequests ? children : <LoadingSkeleton preset="list" />;
}

export function RequestsRoute() {
  return (
    <AccessRequestsGate>
      <RequestsPage />
    </AccessRequestsGate>
  );
}
