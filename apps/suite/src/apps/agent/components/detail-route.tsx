// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { usePageRouteParams } from "../../../lib/route-params";
import { guardSlug } from "../lib/paths";
import { AccountsScreen } from "./accounts";
import { ActivityScreen } from "./activity";
import { ApprovalsScreen } from "./approvals";
import { ChatScreen } from "./chat";
import { InboxScreen } from "./inbox";

/** Reads the real slug on native, where the exported router tree contains only placeholders. */
function AgentDetailRoute<K extends string>({
  pattern,
  param,
  validate,
  render,
}: {
  pattern: string;
  param: K;
  validate: (slug: string) => string;
  render: (slug: string) => ReactNode;
}) {
  const params = usePageRouteParams<Record<K, string>>(pattern);
  if (!params) return <LoadingSkeleton preset="list" label="Loading agent records" />;
  let slug: string;
  try {
    slug = validate(params[param]);
  } catch {
    notFound();
  }
  return render(slug);
}

export function AccountsRoute() {
  return (
    <AgentDetailRoute
      pattern="/agent/accounts/[id]"
      param="id"
      validate={guardSlug}
      render={(id) => <AccountsScreen id={id} />}
    />
  );
}

export function ActivityRoute() {
  return (
    <AgentDetailRoute
      pattern="/agent/activity/[seq]"
      param="seq"
      validate={guardSlug}
      render={(seq) => <ActivityScreen seq={seq} />}
    />
  );
}

export function ApprovalsRoute() {
  return (
    <AgentDetailRoute
      pattern="/agent/approvals/[id]"
      param="id"
      validate={guardSlug}
      render={(id) => <ApprovalsScreen id={id} />}
    />
  );
}

export function ChatRoute() {
  return (
    <AgentDetailRoute
      pattern="/agent/chat/c/[id]"
      param="id"
      validate={guardSlug}
      render={(id) => <ChatScreen id={id} />}
    />
  );
}

export function InboxRoute() {
  return (
    <AgentDetailRoute
      pattern="/agent/inbox/[binding]"
      param="binding"
      validate={guardSlug}
      render={(binding) => <InboxScreen binding={binding} />}
    />
  );
}
