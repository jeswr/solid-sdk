// AUTHORED-BY Claude Opus 4.8
"use client";

// Vendored from solid-pod-manager src/components/theme-toggle.tsx
// Source hash tracked in vendor-lock.json; run scripts/check-pm-drift.mjs to detect drift.

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

// Hydration-safe mounted guard using useSyncExternalStore (avoids setState-in-effect lint).
// Server snapshot → false; client snapshot → true. Eliminates the extra render cycle.
const subscribe = () => () => {};
const useIsMounted = () => useSyncExternalStore(subscribe, () => true, () => false);

/** Theme switcher (light / dark / system). Header-level, low-profile. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  // Avoid a hydration mismatch: render a stable placeholder until mounted.
  const Icon = !mounted ? Monitor : theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change colour theme">
          <Icon className="size-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map(({ value, label, icon: ItemIcon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            aria-current={mounted && theme === value ? "true" : undefined}
          >
            <ItemIcon className="size-4" aria-hidden="true" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
