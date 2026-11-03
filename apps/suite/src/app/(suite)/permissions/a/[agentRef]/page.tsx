// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { Suspense } from "react";
import { PermissionAgentRoute } from "@/apps/home/components/native-routes";
import "@/apps/home/components/permissions/permissions.css";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ agentRef: "__" }] : [];
}
export default function Page() {
  return (
    <Suspense>
      <PermissionAgentRoute />
    </Suspense>
  );
}
