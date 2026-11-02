// AUTHORED-BY Codex GPT-6
"use client";
import { Button, ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { ArrowDownToLine, BarChart3, LayoutDashboard, ListTree, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { MoneyProvider, useMoney } from "../state/money-context";
import { AccountDialog } from "./money-forms";

function Chrome({ children }: { children: ReactNode }) {
  const money = useMoney();
  const path = usePathname();
  const [add, setAdd] = useState(false);
  const links = [
    { href: "/money", label: "Overview", Icon: LayoutDashboard },
    { href: "/money/accounts", label: "Accounts", Icon: Wallet },
    { href: "/money/reports", label: "Reports", Icon: BarChart3 },
    { href: "/money/categories", label: "Categories", Icon: ListTree },
    { href: "/money/import", label: "Import", Icon: ArrowDownToLine },
  ];
  return (
    <SuiteFrame
      app="money"
      context={<span>Money</span>}
      search={{ placeholder: "Search in Money", action: "/money/search", scopeLabel: "in Money" }}
      actions={
        <span className="mon-save" role="status">
          {money.saving ? "Saving…" : "Saved to your pod"}
        </span>
      }
      sidebar={
        <nav className="mon-sidebar" aria-label="Money">
          <p className="mon-brand">Money</p>
          <Button onClick={() => setAdd(true)}>
            <Plus size={16} aria-hidden="true" />
            Add account
          </Button>
          <ul>
            {links.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link href={href} aria-current={path === href ? "page" : undefined}>
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mon-eyebrow">Your accounts</p>
          <ul>
            {money.accounts.map((account) => (
              <li key={account.id}>
                <Link
                  href={`/money/a/${encodeRef(account.id)}`}
                  aria-current={path === `/money/a/${encodeRef(account.id)}` ? "page" : undefined}
                >
                  <Wallet size={16} aria-hidden="true" />
                  {account.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mon-private">
            Your finances, in your pod.
            <br />
            No bank connections needed.
          </p>
        </nav>
      }
    >
      <div className="mon-page">
        {money.status === "loading" ? (
          <>
            <h1>Opening Money</h1>
            <LoadingSkeleton preset="table" />
          </>
        ) : money.status === "error" ? (
          <>
            <h1>Couldn't open Money</h1>
            <ErrorState error="unreachable" actions={{ retry: money.refresh }} />
          </>
        ) : (
          children
        )}
      </div>
      <AccountDialog open={add} onOpenChange={setAdd} />
    </SuiteFrame>
  );
}
function Gate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="mon-page">
        <h1>Opening Money</h1>
        <LoadingSkeleton preset="table" />
      </div>
    );
  if (state.status === "error")
    return (
      <div className="mon-page">
        <h1>Couldn't open Money</h1>
        <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
      </div>
    );
  return (
    <MoneyProvider
      key={`${state.session.webId}|${state.session.storageUrl}`}
      session={state.session}
    >
      <Chrome>{children}</Chrome>
    </MoneyProvider>
  );
}
export function MoneyApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <Gate>{children}</Gate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
