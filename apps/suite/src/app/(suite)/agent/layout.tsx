// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AgentApp } from "@/apps/agent/components/agent-app";
import "@/apps/agent/components/agent.css";
export const metadata: Metadata = { title: "Agent · Solid Suite" };
export default function AgentLayout({ children }: { children: ReactNode }) {
  return <AgentApp>{children}</AgentApp>;
}
