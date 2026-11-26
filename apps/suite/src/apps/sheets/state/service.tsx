// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import type { WorkbookService } from "../lib/contract";
import { createWorkbookService } from "../lib/workbook";

const ServiceContext = createContext<WorkbookService | null>(null);
export function WorkbookServiceProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const service = useMemo(
    () =>
      createWorkbookService({
        fetch: session.fetch,
        publicFetch: session.mode === "demo" ? session.fetch : session.publicFetch,
        podRoot: session.storageUrl,
        webId: session.webId,
        ...(session.mode === "solid" &&
          session.grantResource && { grantResource: session.grantResource }),
      }),
    [session],
  );
  const accountId = (session.mode === "solid" && session.accountId) || session.webId;
  return (
    <ServiceContext key={accountId} value={service}>
      {children}
    </ServiceContext>
  );
}
export function useWorkbookService() {
  const service = useContext(ServiceContext);
  if (!service) throw new Error("Sheets needs a WorkbookServiceProvider");
  return service;
}
