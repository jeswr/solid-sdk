// AUTHORED-BY Claude Opus 4.8
"use client";

// Vendored from solid-pod-manager src/components/account-menu.tsx
// Source hash tracked in vendor-lock.json; run scripts/check-pm-drift.mjs to detect drift.

import { LogOut, UserRound } from "lucide-react";
import { useSolidSession } from "@/lib/session-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

/** Initials from a display name, for the avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Header account control: avatar + name, with sign-out. */
export function AccountMenu() {
  const { profile, logout } = useSolidSession();
  const name = profile?.name ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto gap-2 px-2 py-1.5"
          aria-label="Account menu"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-accent text-accent-foreground text-xs">
              {profile ? initials(name) : <UserRound className="size-4" aria-hidden="true" />}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
            {profile?.name ?? "Signed in"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{name}</span>
          {profile?.webId && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {profile.webId}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            logout();
            toast.success("Signed out", {
              description: "Your session ended. Your data stays in your pod.",
            });
          }}
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
