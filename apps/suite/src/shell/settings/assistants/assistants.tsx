// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type AuditSource,
  monthlyAuditSource,
  type PersonalDataRead,
  personalDataCategoryLabel,
} from "@jeswr/mcp-connections";
import {
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { boundedRead } from "@/lib/session/bounded-read";
import { PodSessionProvider } from "@/lib/session/pod-session";
import { usePodSessionState } from "@/lib/session/shell-pod-session";
import type { PodSession } from "@/lib/session/types";
import { CopyButton } from "@/shell/account/account-card";
import { useSuiteEnvironment } from "@/shell/environment";
import { dpvPurposeLabel } from "@/shell/lib/dpv-labels";
import { useOnline } from "@/shell/lib/use-online";
import { ConnectedAssistants } from "./connected";
import { assistantCopy } from "./copy";
import { auditRead } from "./read";
import "./assistants.css";

const decisionLabels: Record<NonNullable<PersonalDataRead["decision"]>, string> = {
  permit: "Allowed",
  "confirm-required": "Confirmation required",
  prohibited: "Blocked",
  "refuse-all": "All access refused",
};
function clientLabel(client: string | undefined, serverUrl: string | undefined) {
  if (!client) return "Unrecognised assistant";
  const url = new URL(client);
  return url.host === (serverUrl ? new URL(serverUrl).host : undefined) &&
    url.pathname.startsWith("/clients/")
    ? `An assistant registered with ${url.host}`
    : `${url.host}${url.pathname.length > 32 ? `${url.pathname.slice(0, 31)}…` : url.pathname}`;
}

export function ConnectAssistant({ url }: { url: string | undefined }) {
  return (
    <section aria-labelledby="connect-assistant">
      <h2 id="connect-assistant">Connect your assistant</h2>
      {url ? (
        <>
          <label htmlFor="assistant-server">Assistant server address</label>
          <div className="assistant-address">
            <Input id="assistant-server" readOnly value={url} />
            <CopyButton value={url} label="Copy assistant server address" />
          </div>
          <Tabs defaultValue="claude">
            <TabsList aria-label="Assistant setup" variant="line">
              {Object.entries(assistantCopy).map(([id, copy]) => (
                <TabsTrigger key={id} value={id}>
                  {copy.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {Object.entries(assistantCopy).map(([id, copy]) => (
              <TabsContent key={id} value={id}>
                <ol className="assistant-steps">
                  {copy.steps.map((step) => (
                    <li key={step}>{step.replace("{url}", url)}</li>
                  ))}
                </ol>
                <p>{copy.footer}</p>
              </TabsContent>
            ))}
          </Tabs>
          <p>Other MCP apps: use this address with OAuth.</p>
        </>
      ) : (
        <p>
          This suite has no assistant server set up. Ask whoever runs your suite for its MCP
          address.
        </p>
      )}
      <p className="assistant-note">
        To disconnect an assistant, remove it in that assistant's connector settings. That stops it
        using your pod. To also cut off its access on the server, ask whoever runs your assistant
        server to revoke it.
      </p>
    </section>
  );
}

type AuditState =
  | { session: PodSession; attempt: number; status: "ready"; rows: PersonalDataRead[] }
  | { session: PodSession; attempt: number; status: "error" };
export function PersonalDataReads({
  session,
  serverUrl,
  source = monthlyAuditSource,
  names = {},
}: {
  session: PodSession;
  serverUrl?: string | undefined;
  source?: AuditSource;
  names?: Record<string, string>;
}) {
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AuditState>();
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    let live = true;
    setState(undefined);
    void boundedRead(
      () => source.list(auditRead(session, signal), session.storageUrl, 100),
      10000,
      signal,
    ).then(
      (rows) => {
        if (live) setState({ session, attempt, status: "ready", rows });
      },
      () => {
        if (live) setState({ session, attempt, status: "error" });
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [session, source, online, attempt]);
  const current = state?.session === session && state.attempt === attempt ? state : undefined;
  return (
    <section aria-labelledby="personal-data-reads">
      <h2 id="personal-data-reads">Sensitive data reads</h2>
      <p>
        Each time a connected assistant reads sensitive personal data, such as health, biometric or
        financial details, your pod records it and it's listed here. Other reads, such as your name
        or address, aren't recorded yet. The data itself is never shown.
      </p>
      {!online ? (
        <EmptyState
          variant="not-available-offline"
          body="Reconnect to load sensitive data reads."
        />
      ) : !current ? (
        <LoadingSkeleton preset="list" count={3} label="Loading sensitive data reads" />
      ) : current.status === "error" ? (
        <ErrorState
          error="unreachable"
          actions={{ retry: () => setAttempt((value) => value + 1) }}
        />
      ) : current.rows.length === 0 ? (
        <EmptyState
          title="No sensitive data reads yet"
          body="Recorded sensitive data reads will appear here."
        />
      ) : (
        <ol className="assistant-audit" aria-label="Sensitive data reads, newest first">
          {current.rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: The read-only projection omits activity IDs and may contain identical metadata rows; items have no local state.
            <li key={`${row.at}-${index}`}>
              <time dateTime={row.at}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(row.at))}
              </time>
              <strong>{names[row.client] ?? clientLabel(row.client, serverUrl)}</strong>
              {row.tool && <span>Tool: {row.tool}</span>}
              {row.purpose && (
                <span>Purpose: {dpvPurposeLabel(row.purpose) ?? "Other purpose"}</span>
              )}
              <span>
                {row.categories.map(personalDataCategoryLabel).join(", ") || "Personal data"}
              </span>
              {row.decision && <span>Decision: {decisionLabels[row.decision]}</span>}
              {row.resourceCount !== undefined && <span>{row.resourceCount} resources</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AssistantSettings() {
  const [attempt, setAttempt] = useState(0);
  return (
    <PodSessionProvider key={attempt}>
      <AssistantSettingsContent retrySession={() => setAttempt((value) => value + 1)} />
    </PodSessionProvider>
  );
}

function AssistantSettingsContent({ retrySession }: { retrySession: () => void }) {
  const env = useSuiteEnvironment();
  const state = usePodSessionState();
  const [named, setNamed] = useState<{ session: PodSession; names: Record<string, string> }>();
  return (
    <>
      <ConnectAssistant url={env.NEXT_PUBLIC_SUITE_MCP_URL} />
      {state.status === "ready" ? (
        <>
          <ConnectedAssistants
            key={state.session.webId}
            session={state.session}
            onNames={setNamed}
          />
          <PersonalDataReads
            session={state.session}
            serverUrl={env.NEXT_PUBLIC_SUITE_MCP_URL}
            names={named?.session === state.session ? named.names : {}}
          />
        </>
      ) : state.status === "loading" ? (
        <LoadingSkeleton preset="list" label="Opening your pod" />
      ) : state.status === "signed-out" ? (
        <p role="status">Sign in to see sensitive data reads.</p>
      ) : (
        <ErrorState error="unreachable" actions={{ retry: retrySession }} />
      )}
    </>
  );
}
