"use client";
// LoginPanel — WebID-first login entry (the reactive-auth UX spec):
//  - ONE input: the user's WebID URL. No identity-provider dropdown — users
//    know their WebID, not their IdP's OIDC URL.
//  - Recent accounts: previously-used WebIDs as avatar buttons, most-recent
//    first, deduplicated, surviving logout (via the vendored RecentAccounts).
//  - Clear error states bubble up from the data layer (no oidcIssuer,
//    unreachable profile, cancelled popup).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSolidAuth } from "./SolidAuthProvider";
import { RecentAccounts, type RecentAccount } from "@/lib/solid/login-ux";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// Subscribe the component to the recent-accounts list via useSyncExternalStore,
// which is the React-19 way to read browser-only/external state without calling
// setState inside an effect. A cached snapshot keeps the reference stable so
// React doesn't loop. The store is bumped by remembering an account.
const recentsListeners = new Set<() => void>();
let recentsSnapshot: RecentAccount[] = [];
function notifyRecents() {
  recentsSnapshot = new RecentAccounts().list();
  for (const l of recentsListeners) l();
}
function useRecentAccounts(): RecentAccount[] {
  return useSyncExternalStore(
    (cb) => {
      recentsListeners.add(cb);
      return () => recentsListeners.delete(cb);
    },
    () => recentsSnapshot, // client snapshot
    () => recentsSnapshot, // server snapshot (empty — localStorage absent)
  );
}

export function LoginPanel() {
  const { login, loggingIn, error, ready, profile } = useSolidAuth();
  const [webIdInput, setWebIdInput] = useState("");
  const recents = useRecentAccounts();
  const remembered = useRef<string | null>(null);

  // Populate the snapshot from localStorage once, on the client, after mount.
  // (Reads only — no React setState here; the store notify drives the update.)
  useEffect(() => {
    notifyRecents();
  }, []);

  // After a successful login, remember the account, then bump the store. Guarded
  // so it runs once per distinct WebID (no setState-in-effect cascade).
  useEffect(() => {
    if (!profile || remembered.current === profile.webId) return;
    remembered.current = profile.webId;
    new RecentAccounts().remember({
      webId: profile.webId,
      displayName: profile.name,
      avatarUrl: profile.avatarUrl,
      issuer: profile.oidcIssuers[0],
      storage: profile.storages[0],
    });
    notifyRecents();
  }, [profile]);

  async function submit(id: string) {
    try {
      await login(id);
    } catch {
      // The error is already surfaced via the auth context's `error`.
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Log in with your Solid Pod</CardTitle>
        <CardDescription>
          Enter your WebID — the URL that identifies you across Solid.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {recents.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Recent accounts</p>
            <div className="flex flex-wrap gap-2">
              {recents.map((a) => (
                <Button
                  key={a.webId}
                  variant="outline"
                  className="flex h-auto items-center gap-2 py-2"
                  disabled={loggingIn || !ready}
                  onClick={() => submit(a.webId)}
                >
                  <Avatar className="size-6">
                    {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt="" />}
                    <AvatarFallback>{initials(a.displayName)}</AvatarFallback>
                  </Avatar>
                  <span className="max-w-40 truncate text-sm">
                    {a.displayName}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        )}

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (webIdInput.trim()) submit(webIdInput.trim());
          }}
        >
          <Input
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://you.solidcommunity.net/profile/card#me"
            value={webIdInput}
            onChange={(e) => setWebIdInput(e.target.value)}
            disabled={loggingIn}
            aria-label="WebID"
          />
          <Button type="submit" disabled={loggingIn || !ready || !webIdInput.trim()}>
            {loggingIn ? "Logging in…" : ready ? "Log in" : "Loading…"}
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
