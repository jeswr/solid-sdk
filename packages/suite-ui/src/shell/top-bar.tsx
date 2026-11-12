// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { useT } from "@jeswr/suite-i18n/react";
import { ArrowLeft, Menu, PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../components/ui/icon-button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

export interface PaneToggle {
  open: boolean;
  controls: string;
  onToggle: () => void;
  /** Advertise the `[` / `]` key via aria-keyshortcuts (default true). */
  keyShortcut?: boolean;
}

export interface TopBarProps {
  appName: string;
  context?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  offlinePill?: ReactNode;
  bell?: ReactNode;
  account?: ReactNode;
  back?: { href: string; label: string };
  sidebarToggle?: PaneToggle;
  detailsToggle?: PaneToggle;
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
  const t = useT();
  return (
    <header className="suite-topbar">
      {back && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                className="suite-shell-icon-button suite-back"
                href={back.href}
                aria-label={back.label}
              >
                <ArrowLeft
                  size={20}
                  strokeWidth={1.75}
                  className="suite-rtl-mirror"
                  aria-hidden="true"
                />
              </a>
            </TooltipTrigger>
            <TooltipContent>{back.label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {sidebarToggle && (
        <IconButton
          variant="ghost"
          type="button"
          data-slot="top-bar-sidebar-toggle"
          className="suite-shell-icon-button"
          label="Toggle sidebar"
          aria-keyshortcuts={sidebarToggle.keyShortcut === false ? undefined : "["}
          aria-expanded={sidebarToggle.open}
          aria-controls={sidebarToggle.controls}
          onClick={sidebarToggle.onToggle}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      )}
      <div className="suite-topbar-context">
        <span>{appName}</span>
        {context && <div className="suite-context-extra">{context}</div>}
      </div>
      <div className="suite-topbar-search">{search}</div>
      {actions && <div className="suite-topbar-actions">{actions}</div>}
      {offlinePill && <div className="suite-topbar-offline">{offlinePill}</div>}
      {detailsToggle && (
        <IconButton
          variant="ghost"
          type="button"
          data-slot="top-bar-details-toggle"
          className="suite-shell-icon-button"
          label="Toggle details pane"
          aria-keyshortcuts={detailsToggle.keyShortcut === false ? undefined : "]"}
          aria-expanded={detailsToggle.open}
          aria-controls={detailsToggle.controls}
          onClick={detailsToggle.onToggle}
        >
          <PanelRight size={20} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      )}
      {bell}
      {account}
      {refreshing && (
        <div className="suite-refresh-progress" role="status" aria-label={t("shell.refreshing")}>
          <span className="suite-visually-hidden">{t("shell.refreshing")}</span>
        </div>
      )}
    </header>
  );
}
