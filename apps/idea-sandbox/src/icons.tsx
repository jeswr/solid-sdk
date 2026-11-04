// AUTHORED-BY Claude Opus 5.5
// Icons: one per story, automation and connected system, so people can scan rather than read.
import { APP, SYSTEM } from "@jeswr/agent-sandbox/world";
import {
  BarChart3,
  Bot,
  Briefcase,
  CalendarCheck,
  Code2,
  Contact,
  CreditCard,
  Database,
  Handshake,
  Hash,
  HeartPulse,
  Home,
  Landmark,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageSquare,
  Receipt,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Ticket,
  Truck,
  UserCheck,
  Users,
  Workflow,
} from "lucide-react";

/** Icons by name (rules and stories refer to icons by these names). */
export const ICONS: Record<string, LucideIcon> = {
  calendar: CalendarCheck,
  ticket: Ticket,
  handshake: Handshake,
  chart: BarChart3,
  mail: Mail,
  contacts: Contact,
  chat: Hash,
  bot: Bot,
  code: Code2,
  home: Home,
  bank: Landmark,
  workflow: Workflow,
  scroll: ScrollText,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const I = ICONS[name] ?? Workflow;
  return <I size={size} aria-hidden="true" strokeWidth={1.8} />;
}

/** One icon per story. */
export const STORY_ICONS: Record<string, LucideIcon> = {
  "chasing-invoices": Receipt,
  "spend-insights": BarChart3,
  "sickness-note": HeartPulse,
  "injected-refund": ShieldAlert,
  "production-database": Database,
  "partner-data": Truck,
  "acting-for-andrew": UserCheck,
  "friendly-upsell": Megaphone,
  "generated-script": Code2,
};

/** Each system or app: an icon, a short name and a colour. */
export const SYSTEM_LOOK: Record<string, { icon: LucideIcon; name: string; hue: number }> = {
  [SYSTEM.crm]: { icon: Users, name: "CRM", hue: 30 },
  [SYSTEM.tickets]: { icon: Ticket, name: "Tickets", hue: 250 },
  [SYSTEM.hr]: { icon: Briefcase, name: "HR", hue: 330 },
  [SYSTEM.email]: { icon: Mail, name: "Email", hue: 15 },
  [SYSTEM.chat]: { icon: MessageSquare, name: "Team chat", hue: 290 },
  [SYSTEM.payments]: { icon: CreditCard, name: "Payments", hue: 150 },
  [SYSTEM.db]: { icon: Database, name: "Database", hue: 210 },
  [SYSTEM.partner]: { icon: Truck, name: "Partner data", hue: 60 },
  [SYSTEM.insights]: { icon: Sparkles, name: "InsightPro AI", hue: 270 },
  [SYSTEM.marketing]: { icon: Megaphone, name: "Marketing", hue: 350 },
  [APP.gmail]: { icon: Mail, name: "Gmail", hue: 25 },
  [APP.hubspot]: { icon: Contact, name: "HubSpot", hue: 45 },
  [APP.jira]: { icon: Ticket, name: "Jira", hue: 250 },
  [APP.slack]: { icon: Hash, name: "Slack", hue: 300 },
};

export function SystemBadge({ system, label = true }: { system: string; label?: boolean }) {
  const look = SYSTEM_LOOK[system];
  const I = look?.icon ?? Workflow;
  return (
    <span className="sys" style={{ "--hue": look?.hue ?? 200 } as React.CSSProperties}>
      <span className="sys-icon">
        <I size={14} aria-hidden="true" strokeWidth={2} />
      </span>
      {label && <span>{look?.name ?? "System"}</span>}
    </span>
  );
}
