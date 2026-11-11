// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { type ComponentProps, lazy, Suspense } from "react";
import {
  SearchBox,
  SuiteFrame,
  type SuiteFrameProps,
} from "@/components/interim-shell/suite-frame";
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

/** Apps retain their sidebar and details; the shell owns global navigation and account UI. */
export function AppFrame({
  pageTitle,
  ...props
}: Omit<SuiteFrameProps, "app"> & { app: "home" | "drive"; pageTitle?: string | undefined }) {
  const accounts = useShellAccounts();
  if (!accounts) return <SuiteFrame {...props} />;
  const title = pageTitle ?? (props.app === "home" ? "Home" : "Drive");
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
