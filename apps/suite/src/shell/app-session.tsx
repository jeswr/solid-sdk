// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Toaster } from "@jeswr/suite-ui";
import { type ComponentType, Fragment, type ReactNode, Suspense } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppSessionGuard } from "./app-frame";

interface AppSessionProps {
  name: string;
  className: string;
  signedOut?: ReactNode;
  retry?: boolean;
  suspense?: boolean;
  boundary?: ComponentType<{ children: ReactNode }>;
  children: (session: PodSession) => ReactNode;
}

function SessionGate({ name, className, signedOut, retry, children }: AppSessionProps) {
  const state = usePodSessionState();
  if (state.status === "ready")
    return (
      <Fragment
        key={JSON.stringify([state.session.mode, state.session.webId, state.session.storageUrl])}
      >
        {children(state.session)}
      </Fragment>
    );
  return (
    <div className={className} role={state.status === "error" ? "alert" : "status"}>
      {state.status === "loading" ? (
        `Opening your ${name}…`
      ) : state.status === "signed-out" ? (
        <>
          <h1>Sign in to open your {name}</h1>
          {signedOut}
        </>
      ) : (
        <>
          <h1>Can't open your {name}</h1>
          <p>
            {state.mode === "extension"
              ? "This browser couldn't open your pod through the Solid extension."
              : "This browser couldn't open the demo pod's storage."}
          </p>
          {retry && <Button onClick={() => location.reload()}>Retry</Button>}
        </>
      )}
    </div>
  );
}

/** Guard before opening a pod; preserve each app's preview states and provider lifetime. */
export function AppSession({ boundary: Boundary = Fragment, suspense, ...props }: AppSessionProps) {
  const gate = <SessionGate {...props} />;
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <Boundary>
          {suspense ? (
            <Suspense
              fallback={
                <div className={props.className} role="status">
                  Opening your {props.name}…
                </div>
              }
            >
              {gate}
            </Suspense>
          ) : (
            gate
          )}
          <Toaster position="bottom-center" />
        </Boundary>
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
