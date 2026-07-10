// AUTHORED-BY Claude Fable 5
//
// The demo root: the REAL app shell + the REAL four views (Dashboard /
// DataClass / Inbox / History) over the inert Ada-&-Bex fixture pod — no
// login, no LoginController, no network. The read-only demo fetch throws on
// every write, so Approve / Deny / Revoke render exactly like the real app
// but surface "Demo mode — sample data only; changes are disabled." instead
// of persisting anything. Only ever loaded behind the ?demo gate in main.tsx.

import { ThemeProvider } from "@jeswr/app-shell";
import { useMemo } from "react";
import { SessionProvider } from "../auth/SessionContext.js";
import { Shell, type Tab } from "../ui/App.jsx";
import { createDemoSession } from "./fixtures.js";
import type { DemoView } from "./gate.js";

const TAB_FOR_VIEW: Record<DemoView, Tab> = {
  dashboard: "dashboard",
  inbox: "inbox",
  history: "history",
  dataclass: "classes",
};

export function DemoApp({ view }: { view: DemoView }) {
  const session = useMemo(() => createDemoSession().session, []);
  return (
    <ThemeProvider>
      <div className="demo-banner" role="note" data-testid="demo-banner">
        <strong>Demo</strong> — sample data (not a real pod). You are browsing Ada&rsquo;s simulated
        pod; changes are disabled.
      </div>
      <SessionProvider session={session}>
        <Shell webId={session.webId} onSignOut={() => undefined} initialTab={TAB_FOR_VIEW[view]} />
      </SessionProvider>
    </ThemeProvider>
  );
}
