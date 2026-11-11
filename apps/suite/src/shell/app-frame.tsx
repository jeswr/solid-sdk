// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { type ComponentProps, lazy, Suspense } from "react";
import { SuiteFrame, type SuiteFrameProps } from "@/components/interim-shell/suite-frame";
import { loadGuard, loadShell } from "./app-frame-loaders";
import { useOptionalAccounts } from "./session/accounts-context";

const Shell = lazy(async () => ({ default: (await loadShell()).SuiteShell }));
const Guard = lazy(async () => ({
  default: (await loadGuard()).SessionGuard,
}));

/** Preserve standalone/native previews while real app routes share shell authentication. */
export function AppSessionGuard({ children }: { children: React.ReactNode }) {
  const accounts = useOptionalAccounts();
  return accounts && (accounts.status === "loading" || accounts.status === "signed-out") ? (
    <Suspense>
      <Guard>{children}</Guard>
    </Suspense>
  ) : (
    children
  );
}

/** Apps retain their sidebar and details; the shell owns global navigation and account UI. */
export function AppFrame(props: Omit<SuiteFrameProps, "app"> & { app: "home" | "drive" }) {
  const accounts = useOptionalAccounts();
  if (!accounts) return <SuiteFrame {...props} />;
  const title = props.app === "home" ? "Home" : "Drive";
  return (
    <Suspense>
      <Shell
        app={props.app}
        pageTitle={title}
        sidebar={{ label: `${title} navigation`, sections: [], header: props.sidebar }}
        context={props.context}
        actions={props.actions}
        {...(props.details ? { details: { title: "Details", children: props.details } } : {})}
      >
        {props.children}
      </Shell>
    </Suspense>
  );
}

/** ShellFrame supplies the page h1; app content keeps its heading in standalone previews. */
export function AppHeading(props: ComponentProps<"h1">) {
  const accounts = useOptionalAccounts();
  return accounts ? <h2 {...props} /> : <h1 {...props} />;
}
