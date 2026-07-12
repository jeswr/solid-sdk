// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// AccountMenu — the top-right account control: avatar + display name, opening a
// dropdown with the WebID, optional Profile / Settings entries, and Sign out.
//
// DECOUPLED BY DESIGN: unlike PM's version (which read `useSession()` and called
// `toast`), this takes everything as PROPS — `webId`, `displayName`, `avatarUrl`,
// and the `onSignOut` / `onProfile` / `onSettings` callbacks — so it has no
// app-specific coupling and works in any app (Vite or Next). The host wires its
// own session + navigation + toast in the callbacks. Profile/Settings entries
// render ONLY when their callback (or href) is supplied.

import { LogOut, Settings, UserRound } from "lucide-react";
import type * as React from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives.js";

/** Initials from a display name, for the avatar fallback. Exported for tests. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  // length >= 2 here, so the last element exists; `?? first` is an unreachable
  // type-narrowing fallback (keeps the access provably safe without changing
  // behaviour — the runtime always has a distinct last part).
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

export interface AccountMenuProps {
  /** The authenticated user's WebID (shown under the name; the canonical id). */
  webId?: string | null;
  /** Human display name (foaf:name). Falls back to the WebID, then "Account". */
  displayName?: string | null;
  /** Avatar image URL (foaf:img / vcard:hasPhoto). Falls back to initials. */
  avatarUrl?: string | null;
  /** Sign-out callback (required — the menu always offers Sign out). */
  onSignOut: () => void;
  /** Optional: open the profile. Renders a "Profile" item when provided. */
  onProfile?: () => void;
  /** Optional: open settings. Renders a "Settings" item when provided. */
  onSettings?: () => void;
  /** Optional extra menu items rendered above Sign out (e.g. app-specific links). */
  children?: React.ReactNode;
}

/** Header account control: avatar + name, with WebID, optional nav, and sign-out. */
export function AccountMenu({
  webId,
  displayName,
  avatarUrl,
  onSignOut,
  onProfile,
  onSettings,
  children,
}: AccountMenuProps) {
  const name = displayName || webId || "Account";
  const hasIdentity = Boolean(displayName || webId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto gap-2 px-2 py-1.5" aria-label="Account menu">
          <Avatar className="size-7">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback>
              {hasIdentity ? initials(name) : <UserRound className="size-4" aria-hidden="true" />}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
            {displayName || "Signed in"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{name}</span>
          {webId ? (
            <span className="truncate text-xs font-normal text-as-muted-foreground">{webId}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onProfile ? (
          <DropdownMenuItem onClick={onProfile}>
            <UserRound className="size-4" aria-hidden="true" />
            Profile
          </DropdownMenuItem>
        ) : null}
        {onSettings ? (
          <DropdownMenuItem onClick={onSettings}>
            <Settings className="size-4" aria-hidden="true" />
            Settings
          </DropdownMenuItem>
        ) : null}
        {children}
        {onProfile || onSettings || children ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
