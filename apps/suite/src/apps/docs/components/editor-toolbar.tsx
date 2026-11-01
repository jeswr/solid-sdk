// AUTHORED-BY Codex
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import {
  AlignLeft,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  ListFilter,
  MoreHorizontal,
  Palette,
  PanelLeft,
  Printer,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorAction } from "../editor/actions";
import { indentDocument } from "../editor/formatting";
import { keyboardLabel } from "../lib/editor/logic";
import { FONT_FAMILIES } from "../lib/editor/styles";
import { SpacingItems, ZOOMS } from "./editor-menubar";
import { ColourPopover, FontSelect, FontSizeControl } from "./formatting-controls";
import { tableCommands } from "./table-actions";

const OVERFLOW_FIRST = new Set(["Print", "Zoom"]);

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
  zoom = 100,
  setZoom = () => {},
  print = () => {},
  outline = true,
  toggleOutline = () => {},
}: {
  editor: Editor;
  actions: EditorAction[];
  mac: boolean;
  online: boolean;
  zoom?: number;
  setZoom?: (value: number) => void;
  print?: () => void;
  outline?: boolean;
  toggleOutline?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const [width, setWidth] = useState(0);
  const [colour, setColour] = useState<"color" | "backgroundColor" | null>(null);
  const choose = (run: () => void) => () => {
    pending.current = run;
  };
  const afterClose = (event: Event) => {
    const run = pending.current;
    if (run) {
      event.preventDefault();
      pending.current = null;
      run();
    }
  };
  const controls = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>("button,select,input") ?? []).filter(
      (control) => !control.matches(":disabled"),
    );
  const rove = (target: HTMLElement) => {
    active.current = target;
    for (const control of controls()) control.tabIndex = control === target ? 0 : -1;
  };
  useLayoutEffect(() => {
    const available = controls();
    const target =
      active.current && available.includes(active.current) ? active.current : available[0];
    if (target) rove(target);
  });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const menuAction = (action: EditorAction) => (
    <DropdownMenuItem
      key={action.label}
      disabled={!online && action.label === "Insert image"}
      textValue={action.label}
      onSelect={choose(() => {
        action.run();
        if (
          !action.opensControl &&
          !document.querySelector('[role="dialog"], [role="alertdialog"]')
        )
          editor.commands.focus();
      })}
    >
      {action.label}
      {action.keys && (
        <>
          {" "}
          <Kbd>{keyboardLabel(action.keys, mac)}</Kbd>
        </>
      )}
    </DropdownMenuItem>
  );
  const dropdown = (label: string, icon: typeof AlignLeft, items: ReactNode) => {
    const Icon = icon;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <Icon aria-hidden="true" size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="docs-editor-menu" onCloseAutoFocus={afterClose}>
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const align = actions.filter((action) =>
    ["Align left", "Align centre", "Align right", "Justify"].includes(action.label),
  );
  const groups: { label: string; width: number; control: ReactNode; overflow: ReactNode }[] = [];
  const addAction = (label: string) => {
    const action = actions.find((action) => action.label === label);
    if (action)
      groups.push({
        label,
        width: 34,
        control: (
          <ToolButton action={action} mac={mac} disabled={!online && label === "Insert image"} />
        ),
        overflow: menuAction(action),
      });
  };
  addAction("Undo");
  addAction("Redo");
  groups.push({
    label: "Print",
    width: 34,
    control: (
      <Button variant="ghost" size="icon-sm" aria-label="Print" onClick={print}>
        <Printer aria-hidden="true" size={18} />
      </Button>
    ),
    overflow: <DropdownMenuItem onSelect={choose(print)}>Print</DropdownMenuItem>,
  });
  groups.push({
    label: "Zoom",
    width: 72,
    control: (
      <select
        aria-label="Zoom"
        className="docs-block-select docs-zoom-select"
        value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}
      >
        {ZOOMS.map((value) => (
          <option key={value} value={value}>
            {value}%
          </option>
        ))}
      </select>
    ),
    overflow: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Zoom</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {ZOOMS.map((value) => (
            <DropdownMenuItem key={value} onSelect={choose(() => setZoom(value))}>
              {value}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
  });
  groups.push({
    label: "Paragraph style",
    width: 116,
    control: <BlockSelect editor={editor} />,
    overflow: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Paragraph style</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {actions
            .filter((action) =>
              [
                "Normal text",
                "Heading 1",
                "Heading 2",
                "Heading 3",
                "Quote",
                "Code block",
              ].includes(action.label),
            )
            .map(menuAction)}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
  });
  groups.push({
    label: "Font family",
    width: 130,
    control: <FontSelect editor={editor} />,
    overflow: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Font family</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {FONT_FAMILIES.map((font) => (
            <DropdownMenuItem
              key={font.value}
              onSelect={choose(() => {
                editor.chain().focus().setFontFamily(font.value).run();
              })}
            >
              {font.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
  });
  groups.push({
    label: "Font size",
    width: 100,
    control: <FontSizeControl editor={editor} />,
    overflow: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Font size</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <div className="docs-size-menu">
            <FontSizeControl editor={editor} />
          </div>
          {[8, 10, 11, 12, 14, 18, 24, 36, 48, 72, 96].map((value) => (
            <DropdownMenuItem
              key={value}
              onSelect={choose(() => {
                editor.chain().focus().setFontSize(`${value}pt`).run();
              })}
            >
              {value} pt
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
  });
  ["Bold", "Italic", "Underline"].forEach(addAction);
  for (const [kind, label, Icon] of [
    ["color", "Text colour", Palette],
    ["backgroundColor", "Highlight colour", Highlighter],
  ] as const)
    groups.push({
      label,
      width: 34,
      control: (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={colour === kind}
          onClick={() => setColour(kind)}
        >
          <Icon aria-hidden="true" size={18} />
        </Button>
      ),
      overflow: (
        <DropdownMenuItem onSelect={choose(() => setColour(kind))}>{label}</DropdownMenuItem>
      ),
    });
  addAction("Link");
  addAction("Insert image");
  groups.push({
    label: "Text alignment",
    width: 34,
    control: dropdown("Text alignment", AlignLeft, align.map(menuAction)),
    overflow: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Text alignment</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{align.map(menuAction)}</DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
  });
  groups.push({
    label: "Line and paragraph spacing",
    width: 34,
    control: dropdown(
      "Line and paragraph spacing",
      ListFilter,
      <SpacingItems editor={editor} choose={choose} />,
    ),
    overflow: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Line and paragraph spacing</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <SpacingItems editor={editor} choose={choose} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
  });
  ["Checklist", "Bulleted list", "Numbered list"].forEach(addAction);
  for (const [label, direction, Icon] of [
    ["Decrease indent", -1, IndentDecrease],
    ["Increase indent", 1, IndentIncrease],
  ] as const) {
    const run = () => {
      indentDocument(editor, direction);
    };
    groups.push({
      label,
      width: 34,
      control: (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
        >
          <Icon aria-hidden="true" size={18} />
        </Button>
      ),
      overflow: <DropdownMenuItem onSelect={choose(run)}>{label}</DropdownMenuItem>,
    });
  }
  addAction("Clear formatting");
  // Controls keep their order but leave for More by priority: print and zoom go first
  // (phones pinch to zoom), so the Block type control stays on the bar on a phone.
  const ranked = [
    ...groups.filter((group) => !OVERFLOW_FIRST.has(group.label)),
    ...groups.filter((group) => OVERFLOW_FIRST.has(group.label)),
  ];
  let used = 76;
  // At the smallest widths the primary undo buttons still fit beside the overflow trigger.
  const shown = new Set(ranked.slice(0, 2).map((group) => group.label));
  for (const group of ranked) {
    used += group.width;
    if (used > width) break;
    shown.add(group.label);
  }
  const visible = groups.filter((group) => shown.has(group.label));
  const hidden = groups.filter((group) => !shown.has(group.label));
  return (
    <div
      ref={ref}
      className="docs-toolbar"
      role="toolbar"
      aria-label="Formatting"
      onFocusCapture={(event) => {
        const control = (event.target as HTMLElement).closest<HTMLElement>("button,select,input");
        if (control && controls().includes(control)) rove(control);
      }}
      onKeyDown={(event) => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          (event.target as HTMLElement).tagName === "INPUT"
        )
          return;
        const available = controls();
        const index = available.indexOf(event.target as HTMLElement);
        if (index < 0) return;
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
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={outline ? "Hide outline" : "Show outline"}
        aria-pressed={outline}
        data-docs-outline-toggle=""
        onClick={toggleOutline}
      >
        <PanelLeft aria-hidden="true" size={18} />
      </Button>
      {visible.map((group) => (
        <div className="docs-toolbar-control" key={group.label}>
          {group.control}
        </div>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More formatting">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="docs-more-menu docs-editor-menu"
          onCloseAutoFocus={afterClose}
        >
          <DropdownMenuLabel>More</DropdownMenuLabel>
          {hidden.map((group) => (
            <div key={group.label}>{group.overflow}</div>
          ))}
          <DropdownMenuSeparator />
          {actions
            .filter(
              (action) =>
                !shown.has(action.label) && !groups.some((group) => group.label === action.label),
            )
            .map(menuAction)}
          {editor.isActive("table") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Table</DropdownMenuLabel>
              {tableCommands(editor).map(([label, run]) => (
                <DropdownMenuItem
                  key={label}
                  onSelect={choose(() => {
                    run();
                  })}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {editor.isActive("image") && (
            <>
              <DropdownMenuSeparator />
              {[25, 50, 75, 100].map((value) => (
                <DropdownMenuItem
                  key={value}
                  onSelect={choose(() => {
                    editor
                      .chain()
                      .focus()
                      .updateAttributes("image", {
                        width: Math.round((editor.view.dom.clientWidth * value) / 100),
                      })
                      .run();
                  })}
                >
                  Image width {value}%
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onSelect={choose(() => {
                  editor.chain().focus().deleteSelection().run();
                })}
              >
                Remove image
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {colour && <ColourPopover editor={editor} kind={colour} close={() => setColour(null)} />}
    </div>
  );
}
