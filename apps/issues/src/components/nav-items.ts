// AUTHORED-BY Claude Opus 4.8
import type { LucideIcon } from "lucide-react";
import {
  CircleDot,
  LayoutGrid,
  ListTodo,
  ChartNoAxesGantt,
  BarChart3,
  CalendarDays,
  Users,
  Layers,
  Bell,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Show in the mobile bottom bar (kept to the most-used destinations). */
  primary?: boolean;
}

/**
 * Primary navigation for Solid Issues.
 * Kept to issue-tracker destinations; the PM shell shape is shared
 * (sidebar + bottom bar), but nav items are app-specific.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Issues", icon: CircleDot, primary: true },
  { href: "/?view=board", label: "Board", icon: LayoutGrid, primary: true },
  { href: "/?view=backlog", label: "Backlog", icon: ListTodo },
  { href: "/?view=epics", label: "Epics", icon: Layers },
  { href: "/?view=timeline", label: "Timeline", icon: ChartNoAxesGantt },
  { href: "/?view=calendar", label: "Calendar", icon: CalendarDays },
  { href: "/?view=dashboard", label: "Dashboard", icon: BarChart3, primary: true },
  { href: "/?view=workload", label: "Workload", icon: Users },
  { href: "/?view=inbox", label: "Inbox", icon: Bell, primary: true },
] as const;
