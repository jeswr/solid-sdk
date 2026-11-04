// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRequestCaps } from "../../state/requests";
import { RequestsPage } from "./requests-page";

/**
 * Decides on the client whether the inbox exists, so the page stays statically exportable for the
 * native build. Without access requests there is no inbox to show (03-home-permissions §6).
 */
export function RequestsRoute() {
  const { accessRequests } = useRequestCaps();
  const router = useRouter();
  useEffect(() => {
    if (!accessRequests) router.replace("/permissions");
  }, [accessRequests, router]);
  return accessRequests ? <RequestsPage /> : <LoadingSkeleton preset="list" />;
}
