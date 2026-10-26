// AUTHORED-BY Codex
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { AlignLeft, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorAction } from "../editor/actions";
import { keyboardLabel } from "../lib/editor/logic";
import { tableCommands } from "./table-actions";
export function ToolButton({
  action,
  mac,
  disabled = false,
}: {
  action: EditorAction;
  mac: boolean;
  disabled?: boolean;
}) {
  const Icon = action.icon;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={action.label}
            aria-pressed={action.active}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={action.run}
          >
            <Icon aria-hidden="true" size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {action.label}
          {action.keys && (
            <>
              {" "}
              <Kbd>{keyboardLabel(action.keys, mac)}</Kbd>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
export function BlockSelect({ editor, label = "Block type" }: { editor: Editor; label?: string }) {
  const value = editor.isActive("heading")
    ? `h${editor.getAttributes("heading").level}`
    : editor.isActive("blockquote")
      ? "quote"
      : editor.isActive("codeBlock")
        ? "code"
        : "paragraph";
  return (
    <select
      aria-label={label}
      className="docs-block-select"
      value={value}
      onChange={(event) => {
        const c = editor.chain().focus();
        const value = event.target.value;
        if (value === "paragraph") c.setParagraph().run();
        else if (value === "quote") c.toggleBlockquote().run();
        else if (value === "code") c.toggleCodeBlock().run();
        else c.toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
      }}
    >
      <option value="paragraph">Normal text</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
      <option value="quote">Quote</option>
      <option value="code">Code block</option>
    </select>
  );
}
export function EditorToolbar({
  editor,
  actions,
  mac,
  online,
}: {
  editor: Editor;
  actions: EditorAction[];
  mac: boolean;
  online: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const activeControl = useRef<HTMLElement | null>(null);
  const controls = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>("button, select") ?? []).filter(
      (control) =>
        !control.matches(":disabled") && (!control.closest(".docs-toolbar-undo") || !small),
    );
  const rove = (active: HTMLElement) => {
    activeControl.current = active;
    for (const control of ref.current?.querySelectorAll<HTMLElement>("button, select") ?? [])
      control.tabIndex = control === active ? 0 : -1;
  };
  // Resize and connectivity changes may remove or disable the previous Tab stop.
  useLayoutEffect(() => {
    const available = controls();
    const active = activeControl.current;
    const target = active && available.includes(active) ? active : available[0];
    if (target) rove(target);
  });
  const [capacity, setCapacity] = useState(3);
  const [small, setSmall] = useState(false);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        const small = matchMedia("(max-width: 767px)").matches;
        const wide = entry.contentRect.width >= 800;
        const unit = matchMedia("(pointer: coarse)").matches ? 46 : 32;
        setSmall(small);
        setWide(wide);
        setCapacity(
          Math.max(
            0,
            Math.min(
              11,
              Math.floor((entry.contentRect.width - (small ? 170 : wide ? 300 : 230)) / unit),
            ),
          ),
        );
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const primary = actions.slice(0, 13);
  const shown = new Set(primary.slice(2, capacity + 2).map((action) => action.label));
  if (!small) {
    shown.add("Undo");
    shown.add("Redo");
  }
  const align = actions.filter((action) =>
    ["Align left", "Align centre", "Align right", "Justify"].includes(action.label),
  );
  const clear = actions.find((action) => action.label === "Clear formatting");
  if (wide) {
    align.forEach((action) => {
      shown.add(action.label);
    });
    shown.add("Clear formatting");
  }
  return (
    <div
      ref={ref}
      className="docs-toolbar"
      role="toolbar"
      aria-label="Formatting"
      onFocusCapture={(event) => {
        const control = (event.target as HTMLElement).closest<HTMLElement>("button, select");
        if (control && controls().includes(control)) rove(control);
      }}
      onKeyDown={(event) => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const available = controls();
        const index = available.indexOf(event.target as HTMLElement);
        if (index < 0) return; // Portalled menus own their keyboard interaction.
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? available.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + available.length) %
                available.length;
        const target = available[next];
        if (target) {
          rove(target);
          target.focus();
        }
      }}
    >
      <div className="docs-toolbar-undo">
        {primary.slice(0, 2).map((action) => (
          <ToolButton key={action.label} action={action} mac={mac} />
        ))}
      </div>
      <BlockSelect editor={editor} />
      <span className="docs-toolbar-divider" />
      {primary.slice(2, capacity + 2).map((action) => (
        <ToolButton
          key={action.label}
          action={action}
          mac={mac}
          disabled={!online && action.label === "Insert image"}
        />
      ))}
      {wide && (
        <>
          <span className="docs-toolbar-divider" />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Text alignment">
                    <AlignLeft aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Text alignment</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              {align.map((action) => (
                <DropdownMenuItem key={action.label} onSelect={action.run}>
                  {action.label}
                  <Kbd>{keyboardLabel(action.keys, mac)}</Kbd>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {clear && <ToolButton action={clear} mac={mac} />}
        </>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More formatting">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More formatting</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="docs-more-menu">
          <DropdownMenuLabel>Formatting</DropdownMenuLabel>
          {actions
            .filter((action) => !shown.has(action.label))
            .map((action) => {
              const Icon = action.icon;
              return (
                <DropdownMenuItem
                  key={action.label}
                  disabled={!online && action.label === "Insert image"}
                  onSelect={action.run}
                >
                  <Icon aria-hidden="true" />
                  {action.label}
                  {action.keys && <Kbd>{keyboardLabel(action.keys, mac)}</Kbd>}
                </DropdownMenuItem>
              );
            })}
          {editor.isActive("table") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Table</DropdownMenuLabel>
              {tableCommands(editor).map(([label, run]) => (
                <DropdownMenuItem key={label} onSelect={run}>
                  {label}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {editor.isActive("image") && (
            <>
              <DropdownMenuSeparator />
              {[25, 50, 75, 100].map((width) => (
                <DropdownMenuItem
                  key={width}
                  onSelect={() =>
                    editor
                      .chain()
                      .focus()
                      .updateAttributes("image", {
                        width: Math.round((editor.view.dom.clientWidth * width) / 100),
                      })
                      .run()
                  }
                >
                  Image width {width}%
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => editor.chain().focus().deleteSelection().run()}>
                Remove image
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
