// AUTHORED-BY Claude Sonnet 5.5
import type { ReactNode } from "react";
import { AppHeader } from "./app-header.js";
import type { FeedbackButtonProps } from "./feedback.js";

/** The structural slice of a signed-in session the frame needs (no auth-package dependency). */
export interface AppFrameSession {
  webId: string;
  displayName?: string;
  avatarUrl?: string;
  podRoot: string;
  /** True when the profile lists no storage, so `podRoot` is only a public fallback. */
  podRootIsFallback?: boolean;
}

export interface AppFrameProps {
  /** App name, used as the header brand and the feedback `appName`. */
  appName: string;
  /** Feedback target and build version (the frame fills in `appName` and `webId`). */
  feedback: Pick<FeedbackButtonProps, "repo" | "appVersion">;
  session: AppFrameSession;
  onSignOut: () => void;
  /** Wording for the "no storage address" note: "<product> can only show public <kind> at <podRoot>". */
  storageNote: { product: string; kind: string; podRootAsCode?: boolean };
  /** Body rendered after the header and the storage note (extra notes, `<main>`). */
  children?: ReactNode;
}

/** The suite's signed-in page frame: `.app-shell` > AppHeader + storage-fallback note + body. */
export function AppFrame({
  appName,
  feedback,
  session,
  onSignOut,
  storageNote,
  children,
}: AppFrameProps) {
  return (
    <div className="app-shell">
      <AppHeader
        brand={appName}
        feedback={{ ...feedback, appName, webId: session.webId }}
        account={{
          webId: session.webId,
          displayName: session.displayName ?? null,
          avatarUrl: session.avatarUrl ?? null,
          onSignOut,
        }}
      />
      {session.podRootIsFallback ? (
        <p className="app-note" role="note">
          Your profile doesn't list a storage address, so {storageNote.product} can only show public{" "}
          {storageNote.kind} at{" "}
          {storageNote.podRootAsCode ? <code>{session.podRoot}</code> : session.podRoot}.
        </p>
      ) : null}
      {children}
    </div>
  );
}
