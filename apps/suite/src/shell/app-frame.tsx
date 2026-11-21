// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { type AppSlug, suiteApps } from "@jeswr/suite-ui";
import { type ComponentProps, lazy, type ReactNode, Suspense } from "react";
import {
  SearchBox,
  SuiteFrame,
  type SuiteFrameProps,
} from "@/components/interim-shell/suite-frame";
import { type PodSession, usePodSessionState } from "@/lib/session/pod-session";
import { loadGuard, loadShell } from "./app-frame-loaders";
import { useOptionalAccounts } from "./session/accounts-context";

// The native export keeps its sign-in placeholder (mobile auth integration pending), so its
// apps stay on the interim frame instead of the shell's web sign-in redirect.
const nativeTarget = process.env.NEXT_PUBLIC_SUITE_TARGET === "native";
function useShellAccounts() {
  const accounts = useOptionalAccounts();
  return nativeTarget ? null : accounts;
}

const Shell = lazy(async () => ({ default: (await loadShell()).SuiteShell }));
const Guard = lazy(async () => ({
  default: (await loadGuard()).SessionGuard,
}));

/** Preserve standalone/native previews while real app routes share shell authentication. */
export function AppSessionGuard({ children }: { children: React.ReactNode }) {
  const accounts = useShellAccounts();
  return accounts && (accounts.status === "loading" || accounts.status === "signed-out") ? (
    <Suspense>
      <Guard>{children}</Guard>
    </Suspense>
  ) : (
    children
  );
}

/** Render session states consistently while each app supplies its own content. */
export function PodSessionGate({
  loading,
  signedOut,
  error,
  children,
}: {
  loading: ReactNode;
  signedOut: ReactNode;
  error: (cause: unknown) => ReactNode;
  children: (session: PodSession) => ReactNode;
}) {
  const state = usePodSessionState();
  switch (state.status) {
    case "loading":
      return loading;
    case "signed-out":
      return signedOut;
    case "error":
      return error(state.error);
    case "ready":
      return children(state.session);
  }
}

/** Apps retain their sidebar and details; the shell owns global navigation and account UI. */
export function AppFrame(props: Omit<SuiteFrameProps, "app"> & { app: AppSlug }) {
  const accounts = useShellAccounts();
  if (!accounts) return <SuiteFrame {...props} />;
  const title = suiteApps.find((app) => app.slug === props.app)?.name ?? props.app;
  return (
    <Suspense>
      <Shell
        app={props.app}
        pageTitle={title}
        sidebar={{ label: `${title} navigation`, sections: [], header: props.sidebar }}
        context={props.context}
        actions={props.actions}
        search={props.search ? <SearchBox search={props.search} /> : undefined}
        {...(props.details
          ? {
              details: {
                title: "Details",
                children: props.details,
                open: true,
                onOpenChange: (open: boolean) => !open && props.onDetailsClose?.(),
              },
            }
          : {})}
      >
        {props.children}
      </Shell>
    </Suspense>
  );
}

/** ShellFrame supplies the page h1; app content keeps its heading in standalone previews. */
export function AppHeading(props: ComponentProps<"h1">) {
  const accounts = useShellAccounts();
  return accounts ? <h2 {...props} /> : <h1 {...props} />;
}
