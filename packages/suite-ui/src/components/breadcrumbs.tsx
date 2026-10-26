// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { ChevronRight, Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type DragEventHandler, useLayoutEffect, useRef, useState } from "react";
import { MenuContent } from "./menu.js";

export interface BreadcrumbItem {
  id: string;
  label: string;
  href: string;
  onDrop?: DragEventHandler<HTMLAnchorElement>;
}
export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  label?: string;
}

export function Breadcrumbs({ items, label = "Breadcrumb" }: BreadcrumbsProps) {
  const root = useRef<HTMLElement>(null);
  const measure = useRef<HTMLOListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const expandFocus = useRef<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const container = root.current;
    const measurements = measure.current;
    if (!container || !measurements) return;
    const resize = () => {
      const available = container.getBoundingClientRect().width;
      if (!available) return;
      const list = container.firstElementChild;
      const styles = list ? getComputedStyle(list) : undefined;
      const padding =
        (Number.parseFloat(styles?.paddingLeft ?? "0") || 0) +
        (Number.parseFloat(styles?.paddingRight ?? "0") || 0);
      const next =
        items.length > 2 && measurements.getBoundingClientRect().width + padding > available;
      const hasFocus =
        container.contains(document.activeElement) ||
        menu.current?.contains(document.activeElement);
      const activeId = hasFocus
        ? (document.activeElement as HTMLElement | null)?.dataset.crumbId
        : undefined;
      restoreFocus.current =
        next && activeId !== undefined && items.slice(1, -1).some((item) => item.id === activeId);
      if (!next) {
        if (
          hasFocus &&
          trigger.current &&
          (document.activeElement === trigger.current ||
            trigger.current.getAttribute("aria-expanded") === "true")
        )
          expandFocus.current = activeId ?? items[1]?.id;
        setOpen(false);
      }
      setCollapsed(next);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    observer.observe(measurements);
    return () => observer.disconnect();
  }, [items]);
  useLayoutEffect(() => {
    if (collapsed && restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
    if (!collapsed && expandFocus.current) {
      Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])
        .find((element) => element.dataset.crumbId === expandFocus.current)
        ?.focus();
      expandFocus.current = undefined;
    }
  }, [collapsed]);

  function link(item: BreadcrumbItem, current: boolean) {
    return (
      <a
        className="suite-crumb-link"
        data-crumb-id={item.id}
        href={item.href}
        aria-current={current ? "page" : undefined}
        onDrop={item.onDrop}
        onDragOver={item.onDrop ? (event) => event.preventDefault() : undefined}
      >
        {item.label}
      </a>
    );
  }
  const visible = collapsed
    ? items.filter((_, index) => index === 0 || index === items.length - 1)
    : items;
  return (
    <nav ref={root} className="suite-breadcrumbs" aria-label={label}>
      <ol className="suite-crumb-list">
        {visible.map((item, index) => (
          <li className="suite-crumb" key={item.id}>
            {index > 0 && (
              <ChevronRight
                className="suite-crumb-separator"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            )}
            {collapsed && index === 1 && (
              <>
                <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
                  <DropdownMenu.Trigger
                    ref={trigger}
                    className="suite-button suite-small"
                    aria-label="Show parent folders"
                    title="Show parent folders"
                  >
                    <Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <MenuContent ref={menu} label="Parent folders">
                    {items.slice(1, -1).map((parent) => (
                      <DropdownMenu.Item key={parent.id} asChild className="suite-menu-item">
                        {link(parent, false)}
                      </DropdownMenu.Item>
                    ))}
                  </MenuContent>
                </DropdownMenu.Root>
                <ChevronRight
                  className="suite-crumb-separator"
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </>
            )}
            {link(item, item.id === items.at(-1)?.id)}
          </li>
        ))}
      </ol>
      <ol ref={measure} className="suite-measure suite-crumb-list" aria-hidden="true" inert>
        {items.map((item, index) => (
          <li className="suite-crumb" key={item.id}>
            {index > 0 && <ChevronRight size={16} strokeWidth={1.75} />}
            <span className="suite-crumb-link">{item.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
