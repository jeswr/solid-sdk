// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { CountBadge } from "@jeswr/suite-ui";
import {
  Activity,
  CheckCheck,
  Contact,
  Inbox,
  MessageSquare,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { pendingApprovals } from "../lib/queue";
import { loadedRecords, readApprovals, readOutbox, readProposals } from "../lib/readers";
import { createAgentVerifier } from "../lib/verify";
import { StatusPill, useDaemonStatus } from "./status-pill";

const NAV = [
  ["chat", "Chat", MessageSquare],
  ["approvals", "Approvals", CheckCheck],
  ["permissions", "Permissions", ShieldCheck],
  ["accounts", "Accounts", Contact],
  ["inbox", "Inbox", Inbox],
  ["activity", "Activity", Activity],
  ["settings", "Settings", Settings],
] as const;
export function AgentSidebar() {
  const pathname = usePathname();
  const { session } = useAgentWorkspace();
  const status = useDaemonStatus();
  const queue = useAgentQuery(session.storageUrl, async (c) =>
    pendingApprovals(
      loadedRecords(await readProposals(c)),
      loadedRecords(await readApprovals(c, createAgentVerifier(session))),
      loadedRecords(await readOutbox(c)),
      Date.now(),
    ),
  );
  return (
    <div className="agent-app agent-sidebar">
      <StatusPill status={status} />
      <nav aria-label="Agent">
        <ul>
          {NAV.map(([slug, label, Icon]) => (
            <li key={slug}>
              <Link
                href={`/agent/${slug}`}
                aria-current={pathname.startsWith(`/agent/${slug}`) ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
                {slug === "approvals" && queue.status === "ready" && (
                  <CountBadge
                    count={queue.data.filter((row) => row.state === "pending").length}
                    label="waiting for approval"
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="agent-demo">
        Your personal agent
        <br />
        Records from your demo pod
      </p>
    </div>
  );
}
