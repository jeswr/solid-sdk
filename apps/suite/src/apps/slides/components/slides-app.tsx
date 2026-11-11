// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { SlidesProvider } from "../state/slides-context";
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
export function SlidesApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <Session />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
