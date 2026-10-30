// AUTHORED-BY Codex GPT-6.1-Sol
import {
  Calendar,
  ContactRound,
  FileText,
  HardDrive,
  HeartPulse,
  House,
  Image,
  Mail,
  MessageCircle,
  Music2,
  ShieldCheck,
  SquareCheckBig,
  StickyNote,
  Table2,
  Wallet,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "../../lib/utils.js";

export const APP_ICONS = {
  home: { label: "Home", glyph: "house", hue: 205, icon: House },
  drive: { label: "Drive", glyph: "hard-drive", hue: 250, icon: HardDrive },
  docs: { label: "Docs", glyph: "file-text", hue: 280, icon: FileText },
  tasks: { label: "Tasks", glyph: "check-square-2", hue: 150, icon: SquareCheckBig },
  calendar: { label: "Calendar", glyph: "calendar", hue: 40, icon: Calendar },
  contacts: { label: "Contacts", glyph: "contact-round", hue: 320, icon: ContactRound },
  notes: { label: "Notes", glyph: "sticky-note", hue: 85, icon: StickyNote },
  photos: { label: "Photos", glyph: "image", hue: 350, icon: Image },
  chat: { label: "Chat", glyph: "message-circle", hue: 300, icon: MessageCircle },
  sheets: { label: "Sheets", glyph: "table-2", hue: 170, icon: Table2 },
  mail: { label: "Mail", glyph: "mail", hue: 20, icon: Mail },
  music: { label: "Music", glyph: "music-2", hue: 335, icon: Music2 },
  money: { label: "Money", glyph: "wallet", hue: 130, icon: Wallet },
  health: { label: "Health", glyph: "heart-pulse", hue: 10, icon: HeartPulse },
  permissions: { label: "Permissions", glyph: "shield-check", hue: 225, icon: ShieldCheck },
} as const;
export type AppId = keyof typeof APP_ICONS;
export type AppIconProps = {
  app: AppId;
  size?: 32 | 40 | 48;
  decorative?: boolean;
  className?: string;
};

export function AppIcon({ app, size = 40, decorative = false, className }: AppIconProps) {
  const { icon: Glyph, label, glyph } = APP_ICONS[app];
  return (
    <span
      className={cn("suite-app-icon", className)}
      role="img"
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      data-app={app}
      data-glyph={glyph}
      style={{ width: size, height: size, "--tile-fill": `var(--app-${app})` } as CSSProperties}
    >
      <svg viewBox="0 0 40 40" className="suite-app-hex" aria-hidden="true">
        <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" />
      </svg>
      <Glyph size={20} strokeWidth={1.75} className="suite-app-glyph" aria-hidden="true" />
    </span>
  );
}
