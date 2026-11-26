// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { BarChart3, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRoutePathname } from "@/lib/route-params";
import { PodSessionProvider } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard, PodSessionGate } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { InsightsProvider, useInsights } from "../state/insights-context";

const views = [
  ["/insights", "Overview"],
  ["/insights/explore", "Explore"],
  ["/insights/trends", "Trends"],
  ["/insights/sources", "Sources"],
] as const;
function Navigation() {
  const pathname = useRoutePathname();
  return (
    <nav className="ins-nav" aria-label="Insights views">
      {views.map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
function Frame({ children }: { children: ReactNode }) {
  const { status, refresh, refreshing, session, timeZone, sources } = useInsights();
  const connection = useConnectionState();
  return (
    <AppFrame
      app="insights"
      sidebar={
        <aside className="ins-sidebar">
          <BarChart3 size={28} aria-hidden="true" />
          <strong>Insights</strong>
          <p>Your everyday patterns, together.</p>
          <p className="ins-muted">
            Your data is analysed in this browser. Insights reads your records without changing
            them.
          </p>
        </aside>
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={refreshing || connection !== "online"}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh sources"}
        </Button>
      }
    >
      <div className="ins-page">
        <Navigation />
        <div className="ins-meta">
          <span>Last 150 days · {timeZone}</span>
          {session.mode === "demo" && <span>Fictional sample data</span>}
        </div>
        {connection !== "online" && (
          <p role="status" className="ins-notice">
            You're offline. You can explore data already loaded here. Reconnect to refresh your
            sources.
          </p>
        )}
        {status === "loading" ? (
          <LoadingSkeleton preset="grid" label="Finding patterns in your pod" />
        ) : status === "error" ? (
          <ErrorState error="unreachable" actions={{ retry: refresh }}>
            <p>
              We couldn't open your sources. Check your connection and pod access, then try again.
            </p>
          </ErrorState>
        ) : (
          <>
            {sources.some((s) => s.status === "error") && (
              <p className="ins-notice" role="status">
                Some sources couldn't be read. Available data is shown below. Visit{" "}
                <Link href="/insights/sources">Sources</Link> for details.
              </p>
            )}
            {children}
          </>
        )}
        <p className="ins-footnote">
          Patterns describe associations, never cause and effect. Findings need at least 14 paired
          days. Missing days are left out. Confidence describes the amount of data, not statistical
          certainty; many comparisons and everyday routines can produce chance patterns. Two series
          that both trend over time can correlate without being related.
        </p>
      </div>
    </AppFrame>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  return (
    <PodSessionGate
      loading={
        <div className="ins-page">
          <LoadingSkeleton preset="grid" label="Opening Insights" />
        </div>
      }
      signedOut={
        <div className="ins-page">
          <AppHeading>Insights</AppHeading>
          <p role="status">Sign in to explore your patterns.</p>
        </div>
      }
      error={() => (
        <div className="ins-page">
          <AppHeading>Can't open Insights</AppHeading>
          <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
        </div>
      )}
    >
      {(session) => (
        <InsightsProvider key={`${session.webId}\u0000${session.storageUrl}`} session={session}>
          <Frame>{children}</Frame>
        </InsightsProvider>
      )}
    </PodSessionGate>
  );
}

export function InsightsApp({ children }: { children: ReactNode }) {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate>{children}</SessionGate>
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
