// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { MenuContent } from "./menu.js";

export interface ToolbarAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  primary?: boolean;
  onSelect: () => void;
}

export interface ToolbarProps {
  label: string;
  actions: readonly ToolbarAction[];
}

export function Toolbar({ label, actions }: ToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const expandFocus = useRef(false);
  const [visible, setVisible] = useState(actions.length);
  const [tabStop, setTabStop] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const container = root.current;
    const measurements = measure.current;
    if (!container || !measurements) return;
    const resize = () => {
      const widths = Array.from(
        measurements.children,
        (child) => child.getBoundingClientRect().width,
      );
      const moreWidth = widths.pop() ?? 0;
      const gap = Number.parseFloat(getComputedStyle(container).columnGap) || 0;
      const styles = getComputedStyle(container);
      const available =
        container.getBoundingClientRect().width -
        (Number.parseFloat(styles.paddingLeft) || 0) -
        (Number.parseFloat(styles.paddingRight) || 0);
      if (!available) return;
      let count = widths.length;
      let total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, count - 1) * gap;
      if (total > available) {
        total += moreWidth + gap;
        while (count > 0 && total > available) {
          count -= 1;
          total -= (widths[count] ?? 0) + gap;
        }
      }
      const activeId = (document.activeElement as HTMLElement | null)?.dataset.actionId;
      if (
        container.contains(document.activeElement) &&
        activeId &&
        actions.findIndex((a) => a.id === activeId) >= count
      )
        restoreFocus.current = true;
      if (count === actions.length) {
        if (
          more.current &&
          (document.activeElement === more.current ||
            more.current.getAttribute("aria-expanded") === "true")
        )
          expandFocus.current = true;
        setOpen(false);
      }
      setVisible(count);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    observer.observe(measurements);
    return () => observer.disconnect();
  }, [actions]);

  useLayoutEffect(() => {
    if (restoreFocus.current && visible < actions.length) {
      more.current?.focus();
      restoreFocus.current = false;
    }
    if (expandFocus.current && visible === actions.length) {
      root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      expandFocus.current = false;
    }
  }, [visible, actions.length]);

  const shown = actions.slice(0, visible);
  const hidden = actions.slice(visible);
  const enabledIds = shown.filter((action) => !action.disabled).map((action) => action.id);
  if (hidden.length) enabledIds.push("__more");
  const currentTabStop = tabStop && enabledIds.includes(tabStop) ? tabStop : enabledIds[0];

  return (
    <div className="suite-toolbar-wrap">
      <div
        ref={root}
        className="suite-toolbar"
        role="toolbar"
        aria-label={label}
        onKeyDown={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.currentTarget.contains(event.target) &&
            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          ) {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
            );
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                    buttons.length;
            event.preventDefault();
            buttons[next]?.focus();
          }
        }}
      >
        {shown.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`suite-button${action.primary ? " suite-primary" : ""}`}
            disabled={Boolean(action.disabled)}
            data-action-id={action.id}
            tabIndex={currentTabStop === action.id ? 0 : -1}
            onFocus={() => setTabStop(action.id)}
            onClick={action.onSelect}
          >
            {action.icon && (
              <span className="suite-action-icon" aria-hidden="true">
                {action.icon}
              </span>
            )}
            {action.label}
          </button>
        ))}
        {hidden.length > 0 && (
          <DropdownMenu.Root open={open} onOpenChange={setOpen}>
            <DropdownMenu.Trigger
              ref={more}
              className="suite-button"
              tabIndex={currentTabStop === "__more" ? 0 : -1}
              onFocus={() => setTabStop("__more")}
            >
              More <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </DropdownMenu.Trigger>
            <MenuContent label={`${label} — More`}>
              {hidden.map((action) => (
                <DropdownMenu.Item
                  key={action.id}
                  className="suite-menu-item"
                  disabled={Boolean(action.disabled)}
                  onSelect={action.onSelect}
                >
                  {action.label}
                </DropdownMenu.Item>
              ))}
            </MenuContent>
          </DropdownMenu.Root>
        )}
      </div>
      <div ref={measure} className="suite-measure suite-toolbar" aria-hidden="true" inert>
        {actions.map((action) => (
          <span key={action.id} className="suite-button">
            {action.icon && <span className="suite-action-icon">{action.icon}</span>}
            {action.label}
          </span>
        ))}
        <span className="suite-button">
          More <ChevronDown size={16} strokeWidth={1.75} />
        </span>
      </div>
    </div>
  );
}
