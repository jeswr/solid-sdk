// AUTHORED-BY Codex GPT-6
import { PermissionAgentPage } from "@/apps/home/components/permissions/agent-page";
import "@/apps/home/components/permissions/permissions.css";

export default async function Page({ params }: { params: Promise<{ agentRef: string }> }) {
  const { agentRef } = await params;
  return <PermissionAgentPage agentRef={agentRef} />;
}
