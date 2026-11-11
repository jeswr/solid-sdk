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

/** Whether this app uses the authenticated web shell rather than the preview frame. */
export function useAppShell() {
  return !!useShellAccounts();
}

const appTitles = { home: "Home", drive: "Drive", mail: "Mail", chat: "Chat" } as const;
type AppFrameProps = Omit<SuiteFrameProps, "app"> & {
  app: keyof typeof appTitles;
  /** Keep details content available while closed so the shell can reopen it. */
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
};

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
export function AppFrame({ detailsOpen, onDetailsOpenChange, ...props }: AppFrameProps) {
  const accounts = useShellAccounts();
  if (!accounts) return <SuiteFrame {...props} />;
  const title = appTitles[props.app];
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
                open: detailsOpen ?? true,
                onOpenChange:
                  onDetailsOpenChange ?? ((open: boolean) => !open && props.onDetailsClose?.()),
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
