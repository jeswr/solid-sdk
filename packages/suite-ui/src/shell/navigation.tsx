// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

export interface SidebarItem {
  id: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  count?: number;
  current?: boolean;
}
export interface SidebarSection {
  id: string;
  label: string;
  items: readonly SidebarItem[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}
export interface SidebarNavProps {
  label: string;
  sections: readonly SidebarSection[];
  header?: ReactNode;
  footer?: ReactNode;
  onNavigate?: (() => void) | undefined;
}

function Section({
  section,
  onNavigate,
}: {
  section: SidebarSection;
  onNavigate: SidebarNavProps["onNavigate"];
}) {
  const headingId = useId();
  const links = (
    <ul aria-labelledby={headingId}>
      {section.items.map(({ id, label, href, icon: Icon, count, current }) => (
        <li key={id}>
          <a href={href} aria-current={current ? "page" : undefined} onClick={onNavigate}>
            {Icon && <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
            <span className="suite-nav-label">{label}</span>
            {count !== undefined && <span className="suite-nav-count">{count}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
  return section.collapsible ? (
    <Collapsible.Root defaultOpen={section.defaultOpen ?? true} className="suite-nav-section">
      <h3 id={headingId}>
        <Collapsible.Trigger className="suite-nav-group">
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          {section.label}
        </Collapsible.Trigger>
      </h3>
      <Collapsible.Content>{links}</Collapsible.Content>
    </Collapsible.Root>
  ) : (
    <div className="suite-nav-section">
      <h3 id={headingId} className="suite-nav-heading">
        {section.label}
      </h3>
      {links}
    </div>
  );
}

export function SidebarNav({ label, sections, header, footer, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label={label} className="suite-sidebar-nav">
      {header}
      {sections.map((section) => (
        <Section key={section.id} section={section} onNavigate={onNavigate} />
      ))}
      {footer && <div className="suite-sidebar-footer">{footer}</div>}
    </nav>
  );
}
