// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type AuditSource,
  monthlyAuditSource,
  type PersonalDataRead,
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
import { useOnline } from "@/apps/home/components/connect/use-online";
import { dpvPurposeLabel } from "@/apps/home/lib/permissions/dpvLabels";
import { boundedRead } from "@/lib/session/bounded-read";
import { PodSessionProvider } from "@/lib/session/pod-session";
import { usePodSessionState } from "@/lib/session/shell-pod-session";
import type { PodSession } from "@/lib/session/types";
import { CopyButton } from "@/shell/account/account-card";
import { useSuiteEnvironment } from "@/shell/environment";
import { ConnectedAssistants } from "./connected";
import { assistantCopy } from "./copy";
import { auditRead } from "./read";
import "./assistants.css";

const categoryLabels: Record<string, string> = {
  Health: "Health",
  HealthRecord: "Health records",
  MedicalHealth: "Medical health",
  Contact: "Contact details",
  ContactDetails: "Contact details",
  EmailAddress: "Email address",
  TelephoneNumber: "Phone number",
  Address: "Address",
  PaymentCard: "Payment card details",
  Financial: "Financial data",
  PersonalData: "Personal data",
};
function categoryLabel(iri: string) {
  const prefix = "https://w3id.org/dpv/pd#";
  const key = iri.slice(prefix.length);
  return iri.startsWith(prefix) && Object.hasOwn(categoryLabels, key)
    ? categoryLabels[key]
    : "Other personal data";
}
function clientLabel(client: string) {
  const url = new URL(client);
  return url.pathname.startsWith("/clients/")
    ? `An assistant registered with ${url.host}`
    : url.host;
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
        In single-user mode, no connection records are written; revoke access by rotating
        MCP_ACCESS_TOKEN on the assistant server.
      </p>
    </section>
  );
}

type AuditState =
  | { session: PodSession; attempt: number; status: "ready"; rows: PersonalDataRead[] }
  | { session: PodSession; attempt: number; status: "error" };
export function PersonalDataReads({
  session,
  source = monthlyAuditSource,
  names = {},
}: {
  session: PodSession;
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
      <h2 id="personal-data-reads">Personal data reads</h2>
      <p>
        Each time a connected assistant reads personal data your pod records, it's listed here. The
        data itself is never shown.
      </p>
      {!online ? (
        <EmptyState variant="not-available-offline" body="Reconnect to load personal data reads." />
      ) : !current ? (
        <LoadingSkeleton preset="list" count={3} label="Loading personal data reads" />
      ) : current.status === "error" ? (
        <ErrorState
          error="unreachable"
          actions={{ retry: () => setAttempt((value) => value + 1) }}
        />
      ) : current.rows.length === 0 ? (
        <EmptyState
          title="No personal data reads yet"
          body="Recorded personal data reads will appear here."
        />
      ) : (
        <ol className="assistant-audit" aria-label="Personal data reads, newest first">
          {current.rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: The read-only projection omits activity IDs and may contain identical metadata rows; items have no local state.
            <li key={`${row.at}-${index}`}>
              <time dateTime={row.at}>
                {new Date(row.at).toLocaleString("en-GB", {
                  timeZone: "UTC",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                UTC
              </time>
              <strong>{names[row.client] ?? clientLabel(row.client)}</strong>
              {row.tool && <span>Tool: {row.tool}</span>}
              {row.purpose && (
                <span>Purpose: {dpvPurposeLabel(row.purpose) ?? "Other purpose"}</span>
              )}
              <span>{row.categories.map(categoryLabel).join(", ") || "Personal data"}</span>
              {row.decision && <span>Decision: {row.decision}</span>}
              {row.resourceCount !== undefined && <span>{row.resourceCount} resources</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AssistantSettings() {
  return (
    <PodSessionProvider>
      <AssistantSettingsContent />
    </PodSessionProvider>
  );
}

function AssistantSettingsContent() {
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
            names={named?.session === state.session ? named.names : {}}
          />
        </>
      ) : state.status === "loading" ? (
        <LoadingSkeleton preset="list" label="Opening your pod" />
      ) : state.status === "signed-out" ? (
        <p role="status">Sign in to see personal data reads.</p>
      ) : (
        <ErrorState error="unreachable" />
      )}
    </>
  );
}
