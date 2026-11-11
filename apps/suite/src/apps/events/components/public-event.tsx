// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import {
  eventDocumentUrl,
  type Invitation,
  publicEventFetch,
  readInvitation,
} from "@jeswr/solid-events";
import { Button, EmptyState, ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { InvitationDetail } from "./event-detail";
import "./events.css";

function PublicInvitation() {
  const parameters = useSearchParams();
  const rawUrl = parameters.get("event");
  const state = usePodSessionState();
  const session = state.status === "ready" ? state.session : undefined;
  const scope = JSON.stringify([rawUrl, session?.webId ?? null]);
  const [loaded, setLoaded] = useState<{ event: Invitation; scope: string }>();
  const event = loaded?.scope === scope ? loaded.event : undefined;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState(false);
  const fetch = useMemo(() => {
    if (session?.mode === "demo" && rawUrl && isWithinPodScope(session.storageUrl, rawUrl))
      return session.fetch;
    return publicEventFetch(
      session && session.mode !== "demo"
        ? session.fetch
        : (input, init) => globalThis.fetch(input, { ...init, credentials: "omit" }),
    );
  }, [session, rawUrl]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the read
  useEffect(() => {
    if (state.status === "loading") return;
    let live = true;
    setLoaded(undefined);
    setFailed(false);
    setSettled(false);
    if (!rawUrl) {
      setSettled(true);
      return;
    }
    void Promise.resolve()
      .then(() => readInvitation(fetch, eventDocumentUrl(rawUrl)))
      .then(
        (result) => {
          if (live) {
            setLoaded({ event: result, scope });
            setSettled(true);
          }
        },
        () => {
          if (live) {
            setFailed(true);
            setSettled(true);
          }
        },
      );
    return () => {
      live = false;
    };
  }, [rawUrl, fetch, state.status, attempt, scope]);
  return (
    <div className="ev-public">
      <a className="ev-public-brand" href="/events">
        Solid Suite · Events
      </a>
      {!rawUrl ? (
        <EmptyState
          title="An invitation needs its link"
          body="Open the complete link your host shared with you."
        />
      ) : !settled ? (
        <LoadingSkeleton preset="list" />
      ) : failed ? (
        <>
          <ErrorState error="unreachable" actions={{ retry: () => setAttempt((a) => a + 1) }} />
          <p className="ev-muted">
            Check the invitation URL, your connection and your access. Private invitations need an
            invited WebID.
          </p>
        </>
      ) : (
        event && (
          <InvitationDetail
            key={`${event.url}:${session?.webId ?? "anonymous"}`}
            event={event}
            fetch={fetch}
            session={session}
          />
        )
      )}
      <footer className="ev-page-footer">
        <p>Made for getting together. Stored in your host's pod.</p>
        <Button variant="outline" asChild>
          <a href="/events">Organise your own event</a>
        </Button>
      </footer>
      <Toaster position="bottom-center" />
    </div>
  );
}
export function PublicEventPage() {
  return (
    <PodSessionProvider>
      <Suspense fallback={<LoadingSkeleton preset="list" />}>
        <PublicInvitation />
      </Suspense>
    </PodSessionProvider>
  );
}
