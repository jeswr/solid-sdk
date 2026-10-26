// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { ArrowLeft, Menu, PanelRight } from "lucide-react";
import type { ReactNode } from "react";

export interface TopBarProps {
  appName: string;
  context?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  offlinePill?: ReactNode;
  bell?: ReactNode;
  account?: ReactNode;
  back?: { href: string; label: string };
  sidebarToggle?: { open: boolean; controls: string; onToggle: () => void };
  detailsToggle?: { open: boolean; controls: string; onToggle: () => void };
  refreshing?: boolean;
}

export function TopBar({
  appName,
  context,
  search,
  actions,
  offlinePill,
  bell,
  account,
  back,
  sidebarToggle,
  detailsToggle,
  refreshing = false,
}: TopBarProps) {
  return (
    <header className="suite-topbar">
      {back && (
        <a
          className="suite-icon-button suite-back"
          href={back.href}
          aria-label={back.label}
          title={back.label}
        >
          <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </a>
      )}
      {sidebarToggle && (
        <button
          type="button"
          className="suite-icon-button"
          aria-label="Toggle sidebar"
          title="Toggle sidebar ([)"
          aria-keyshortcuts="["
          aria-expanded={sidebarToggle.open}
          aria-controls={sidebarToggle.controls}
          onClick={sidebarToggle.onToggle}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      <div className="suite-topbar-context">
        <span>{appName}</span>
        {context && <span className="suite-context-extra">{context}</span>}
      </div>
      <div className="suite-topbar-search">{search}</div>
      {actions && <div className="suite-topbar-actions">{actions}</div>}
      {offlinePill && <div className="suite-topbar-offline">{offlinePill}</div>}
      {detailsToggle && (
        <button
          type="button"
          className="suite-icon-button"
          aria-label="Toggle details pane"
          title="Toggle details pane (])"
          aria-keyshortcuts="]"
          aria-expanded={detailsToggle.open}
          aria-controls={detailsToggle.controls}
          onClick={detailsToggle.onToggle}
        >
          <PanelRight size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {bell}
      {account}
      {refreshing && (
        <div className="suite-refresh-progress" role="status" aria-label="Refreshing content" />
      )}
    </header>
  );
}
