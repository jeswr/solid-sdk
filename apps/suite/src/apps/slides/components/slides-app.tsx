// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
"use client";
import { ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { presenterChannel } from "../state/presentation";
import { SlidesProvider } from "../state/slides-context";
import { PresenterWindow } from "./presenter";
import { SlideSessionContext } from "./slide-canvas";
import { SlidesWorkspace } from "./slides-workspace";

function Opening({ error = false, retry }: { error?: boolean; retry?: () => void }) {
  return (
    <AppFrame app="slides" sidebar={<p className="sld-sidebar-title">Slides</p>}>
      <div className="sld-page">
        <AppHeading>Slides</AppHeading>
        {error ? (
          <ErrorState error="unreachable" actions={retry ? { retry } : {}}>
            <p>Reconnect to open your presentations. Any unsaved drafts stay on this device.</p>
          </ErrorState>
        ) : (
          <LoadingSkeleton preset="grid" label="Opening presentations" />
        )}
      </div>
    </AppFrame>
  );
}
function Session() {
  const state = usePodSessionState();
  if (state.status === "loading") return <Opening />;
  if (state.status === "error") return <Opening error retry={() => location.reload()} />;
  if (state.status === "signed-out") return <p role="status">Sign in to open Slides.</p>;
  return (
    <SlidesProvider
      key={`${state.session.webId}:${state.session.mode}`}
      session={state.session}
      fallback={(error, retry) => <Opening error={error} retry={retry} />}
    >
      <SlidesWorkspace />
    </SlidesProvider>
  );
}
/**
 * The presenter window only mirrors the presenting window over BroadcastChannel. It never opens
 * the collection: no listing, seeding, autosave, draft recovery or pending deletes run here.
 * The session is only for loading slide images.
 */
function Presenter({ channelId }: { channelId: string }) {
  const state = usePodSessionState();
  return (
    <SlideSessionContext value={state.status === "ready" ? state.session : null}>
      <PresenterWindow channelId={channelId} />
    </SlideSessionContext>
  );
}
export function SlidesApp() {
  // Read after mount: the query is not available while rendering on the server.
  const [presenter, setPresenter] = useState<string | null>();
  useEffect(() => setPresenter(presenterChannel(window.location.search)), []);
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        {presenter === undefined ? (
          <Opening />
        ) : presenter ? (
          <Presenter channelId={presenter} />
        ) : (
          <Session />
        )}
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
