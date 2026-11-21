// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, ErrorState, IconButton, LoadingSkeleton } from "@jeswr/suite-ui";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import type { MusicReadFailure } from "../lib/data/library";
import { useMusic } from "../state/music-context";

function denied(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  );
}

/** Retain the page heading and put keyboard focus there when recovery replaces a control. */
export function MusicSurface({
  children,
  area = "library",
  hasData = false,
}: {
  children: ReactNode;
  area?: "library" | "history" | "all";
  hasData?: boolean;
}) {
  const music = useMusic();
  const accounts = useOptionalAccounts();
  const session = usePodSessionState();
  const host = useRef<HTMLDivElement>(null);
  const focusAfter = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<MusicReadFailure[]>();
  const [signInFailed, setSignInFailed] = useState(false);
  const failures = music.snapshot?.failures;
  const relevant = failures?.filter((failure) => area === "all" || failure.area === area) ?? [];
  const count = new Set(failures?.map((failure) => failure.url)).size;
  const wholeError = music.error || (relevant.length > 0 && !hasData);
  const failedArea = music.error ? "library" : relevant[0]?.area;
  const failedResource =
    failedArea === "history"
      ? "listening history"
      : failedArea === "preferences"
        ? "music settings"
        : "music library";
  const focusHeading = useCallback(
    () => host.current?.closest(".mus-content")?.querySelector<HTMLElement>("h1")?.focus(),
    [],
  );
  useEffect(() => {
    if (!busy && focusAfter.current) {
      focusAfter.current = false;
      focusHeading();
    }
  }, [busy, focusHeading]);
  const recover = async (signIn = false) => {
    if (busy) return;
    setBusy(true);
    setSignInFailed(false);
    try {
      if (signIn) {
        if (accounts) await accounts.reauth();
        else await session.connectExtension();
      }
      await music.refresh();
    } catch {
      setSignInFailed(true);
    } finally {
      focusAfter.current = true;
      setBusy(false);
    }
  };
  const canSignIn =
    (accounts?.active?.kind !== "demo" && accounts?.active) || session.extension.present;
  const accessError = denied(music.error) || failures?.some((failure) => denied(failure.error));
  return (
    <div ref={host} aria-busy={busy}>
      {music.status === "loading" ? (
        <LoadingSkeleton label="Loading your music" preset="table" />
      ) : (
        <>
          {wholeError ? (
            <ErrorState error="unreachable" actions={{ retry: () => void recover() }}>
              <p>Couldn’t read your {failedResource}. Try again to load it from your pod.</p>
              {hasData && <p>The music already loaded is still shown below.</p>}
              {accessError && canSignIn && (
                <Button variant="outline" disabled={busy} onClick={() => void recover(true)}>
                  Sign in
                </Button>
              )}
            </ErrorState>
          ) : count > 0 && dismissed !== failures ? (
            <div className="mus-read-notice" role="alert" aria-label="Some music couldn’t be read">
              <p>
                {count} {count === 1 ? "item couldn’t" : "items couldn’t"} be read. Your other music
                is still available.
              </p>
              <Button variant="outline" disabled={busy} onClick={() => void recover()}>
                Retry
              </Button>
              {accessError && canSignIn && (
                <Button variant="outline" disabled={busy} onClick={() => void recover(true)}>
                  Sign in
                </Button>
              )}
              <IconButton
                label="Dismiss music notice"
                variant="ghost"
                onClick={() => {
                  setDismissed(failures);
                  focusHeading();
                }}
              >
                <X size={18} aria-hidden="true" />
              </IconButton>
            </div>
          ) : null}
          {busy && <LoadingSkeleton label="Retrying your music" preset="list" />}
          {signInFailed && <p role="alert">Couldn’t sign in. Please try again.</p>}
          {music.snapshot && (!wholeError || hasData) ? children : null}
        </>
      )}
    </div>
  );
}
