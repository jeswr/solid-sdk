// AUTHORED-BY Claude Opus 5.5
import {
  Boxes,
  Briefcase,
  Calendar,
  CarFront,
  FileText,
  HeartPulse,
  Image,
  type LucideIcon,
  MessageCircle,
  UserRound,
  Wallet,
} from "lucide-react";

/** Lucide components for the `icon` names used by the home model's domains. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  "user-round": UserRound,
  "file-text": FileText,
  calendar: Calendar,
  "heart-pulse": HeartPulse,
  wallet: Wallet,
  image: Image,
  briefcase: Briefcase,
  "car-front": CarFront,
  "message-circle": MessageCircle,
  boxes: Boxes,
};

export function DomainIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Boxes;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.75} />;
}
