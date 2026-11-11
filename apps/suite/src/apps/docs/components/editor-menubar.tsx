// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex
"use client";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Kbd,
} from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import Link from "next/link";
import { type ReactNode, useId, useRef, useState } from "react";
import type { EditorAction } from "../editor/actions";
import { clipboardAction } from "../editor/clipboard";
import type { DownloadFormat } from "../editor/export-document";
import { indentDocument, paragraphSpacing } from "../editor/formatting";
import { keyboardLabel } from "../lib/editor/logic";
import { DownloadMenu } from "./download-menu";
import { VersionMenu, type VersionMenuProps } from "./version-menu";

const MENUS = ["File", "Edit", "View", "Insert", "Format", "Tools", "Help"] as const;
export const ZOOMS = [50, 75, 90, 100, 125, 150, 175, 200];

export function SpacingItems({
  editor,
  choose,
}: {
  editor: Editor;
  choose: (run: () => void) => () => void;
}) {
  return (
    <>
      {[
        ["Single", "1"],
        ["1.15", "1.15"],
        ["1.5", "1.5"],
        ["Double", "2"],
      ].map(([label, value]) => (
        <DropdownMenuItem
          key={value}
          onSelect={choose(() => {
            editor
              .chain()
              .focus()
              .setLineHeight(value as string)
              .run();
          })}
        >
          {label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={choose(() => paragraphSpacing(editor, { spaceBefore: "12pt" }))}>
        Add space before paragraph
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={choose(() => paragraphSpacing(editor, { spaceAfter: "12pt" }))}>
        Add space after paragraph
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={choose(() => paragraphSpacing(editor, { spaceBefore: "0pt", spaceAfter: "0pt" }))}
      >
        Remove paragraph spacing
      </DropdownMenuItem>
    </>
  );
}

export interface EditorMenubarProps extends Partial<VersionMenuProps> {
  editor: Editor;
  actions: EditorAction[];
  mac: boolean;
  online: boolean;
  readOnly: boolean;
  draft: boolean;
  outline: boolean;
  setOutline: (value: boolean) => void;
  zoom: number;
  setZoom: (value: number) => void;
  rename: () => void;
  copy: () => void;
  remove: () => void;
  importFile: () => void;
  print: () => void;
  download: (format: DownloadFormat) => void;
  help: () => void;
  suggesting?: boolean;
  setSuggesting?: (value: boolean) => void;
  resolveSuggestions?: (accept: boolean) => void;
  addComment?: (() => void) | undefined;
  commentReason?: string | undefined;
  share: () => void;
  shareDisabledReason: string | undefined;
}

/**
 * The open menu after `label` reports an open change. A close reported by a menu
 * the bar has already switched away from (for example a dismissal while its exit
 * animation still has it mounted) must not close the newly opened menu.
 */
export function openMenuAfter(current: string | null, label: string, expanded: boolean) {
  if (expanded) return label;
  return current === label ? null : current;
}

/** Radix owns menu/submenu navigation and typeahead; this adds menubar traversal. */
export function EditorMenubar(props: EditorMenubarProps) {
  const { editor, actions, mac, readOnly, resolveSuggestions: resolveAll } = props;
  const shareReasonId = useId();
  const commentReasonId = useId();
  const shareDisabledReason =
    props.shareDisabledReason ?? (readOnly ? "Read-only documents cannot be shared." : undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const switching = useRef(new Set<string>());
  const lastItem = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const choose = (run: () => void) => () => {
    pending.current = run;
  };
  const trigger = (index: number) =>
    root.current?.querySelectorAll<HTMLElement>("[data-docs-menu-trigger]")[index];
  const move = (index: number, expanded: boolean) => {
    const next = (index + MENUS.length) % MENUS.length;
    if (expanded && open) switching.current.add(open);
    setTab(next);
    setOpen(expanded ? (MENUS[next] as string) : null);
    if (!expanded) trigger(next)?.focus();
  };
  const item = (label: string, run: () => void, keys = "", disabled = readOnly) => (
    <DropdownMenuItem key={label} textValue={label} disabled={disabled} onSelect={choose(run)}>
      {label}
      {keys && (
        <>
          {" "}
          <Kbd>{keyboardLabel(keys, mac)}</Kbd>
        </>
      )}
    </DropdownMenuItem>
  );
  const command = (label: string) => {
    const action = actions.find((action) => action.label === label);
    if (!action) return null;
    return item(
      label,
      action.run,
      action.keys,
      readOnly || (!props.online && label === "Insert image"),
    );
  };
  const commands = (labels: string[]) => labels.map(command);
  const sub = (label: string, children: ReactNode) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={readOnly}>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="docs-editor-menu">{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );
  const contents: Record<string, ReactNode> = {
    File: (
      <>
        <DropdownMenuItem asChild>
          <Link href="/docs/new">New</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/docs">Open</Link>
        </DropdownMenuItem>
        {item("Make a copy", props.copy, "", props.draft)}
        <DropdownMenuItem
          disabled={!!shareDisabledReason}
          title={shareDisabledReason}
          aria-describedby={shareDisabledReason ? shareReasonId : undefined}
          onSelect={choose(props.share)}
        >
          Share…
        </DropdownMenuItem>
        {shareDisabledReason && (
          <span id={shareReasonId} className="su-sr-only">
            {shareDisabledReason}
          </span>
        )}
        <DropdownMenuSeparator />
        <DownloadMenu download={props.download} print={props.print} />
        {item("Import to replace…", props.importFile)}
        {item("Rename", props.rename)}
        {props.showHistory && props.nameVersion && (
          <VersionMenu
            showHistory={choose(props.showHistory)}
            nameVersion={choose(props.nameVersion)}
            versionReason={props.versionReason}
          />
        )}
        {item("Move to trash", props.remove, "", readOnly || props.draft)}
        <DropdownMenuSeparator />
        {item("Print", props.print, "Mod+P", false)}
      </>
    ),
    Edit: (
      <>
        {commands(["Undo", "Redo"])}
        <DropdownMenuSeparator />
        {item(
          "Cut",
          () => {
            void clipboardAction(editor, "cut");
          },
          "Mod+X",
        )}
        {item(
          "Copy",
          () => {
            void clipboardAction(editor, "copy");
          },
          "Mod+C",
          false,
        )}
        {item(
          "Paste",
          () => {
            void clipboardAction(editor, "paste");
          },
          "Mod+V",
        )}
        {item(
          "Select all",
          () => {
            editor.chain().focus().selectAll().run();
          },
          "Mod+A",
          false,
        )}
        <DropdownMenuSeparator />
        {item(
          "Find and replace",
          () => actions.find((action) => action.label === "Find and replace")?.run(),
          "Mod+F",
          false,
        )}
      </>
    ),
    View: (
      <>
        {!readOnly && props.setSuggesting && (
          <DropdownMenuCheckboxItem
            checked={props.suggesting ?? false}
            onCheckedChange={props.setSuggesting}
          >
            Suggesting
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuCheckboxItem checked={props.outline} onCheckedChange={props.setOutline}>
          Show outline
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Zoom</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="docs-editor-menu">
            {ZOOMS.map((zoom) => (
              <DropdownMenuCheckboxItem
                key={zoom}
                checked={props.zoom === zoom}
                onSelect={choose(() => props.setZoom(zoom))}
              >
                {zoom}%
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {typeof document !== "undefined" &&
          document.documentElement.requestFullscreen &&
          item(
            "Full screen",
            () => {
              void (document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen());
            },
            "",
            false,
          )}
      </>
    ),
    Insert: (
      <>
        {commands(["Insert image", "Insert table", "Link", "Horizontal rule", "Checklist"])}
        {props.addComment && (
          <>
            <DropdownMenuItem
              disabled={!!props.commentReason}
              title={props.commentReason}
              aria-describedby={props.commentReason ? commentReasonId : undefined}
              onSelect={choose(props.addComment)}
            >
              Comment <Kbd>{keyboardLabel("Mod+Alt+M", mac)}</Kbd>
            </DropdownMenuItem>
            {props.commentReason && (
              <span id={commentReasonId} className="su-sr-only">
                {props.commentReason}
              </span>
            )}
          </>
        )}
      </>
    ),
    Format: (
      <>
        {sub(
          "Text",
          commands([
            "Bold",
            "Italic",
            "Underline",
            "Strikethrough",
            "Superscript",
            "Subscript",
            "Inline code",
          ]),
        )}
        {sub(
          "Paragraph styles",
          commands(["Normal text", "Heading 1", "Heading 2", "Heading 3", "Quote", "Code block"]),
        )}
        {sub(
          "Align and indent",
          <>
            {commands(["Align left", "Align centre", "Align right", "Justify"])}
            <DropdownMenuSeparator />
            {item("Decrease indent", () => {
              indentDocument(editor, -1);
            })}
            {item("Increase indent", () => {
              indentDocument(editor, 1);
            })}
          </>,
        )}
        {sub("Line and paragraph spacing", <SpacingItems editor={editor} choose={choose} />)}
        {sub("Bullets and numbering", commands(["Bulleted list", "Numbered list", "Checklist"]))}
        <DropdownMenuSeparator />
        {command("Clear formatting")}
      </>
    ),
    Tools: (
      <>
        {item(
          "Word count",
          () => actions.find((action) => action.label === "Word count")?.run(),
          "Mod+Shift+C",
          false,
        )}
        {!readOnly && resolveAll && (
          <>
            <DropdownMenuSeparator />
            {item(
              "Review current suggestion",
              () => editor.view.dom.dispatchEvent(new Event("docs-review-suggestion")),
              "Mod+Alt+Shift+A",
            )}
            {item("Accept all suggestions", () => resolveAll(true))}
            {item("Reject all suggestions", () => resolveAll(false))}
          </>
        )}
      </>
    ),
    Help: item("Keyboard shortcuts", props.help, "Mod+/", false),
  };
  return (
    <div ref={root} role="menubar" aria-label="Document menus" className="docs-menubar">
      {MENUS.map((label, index) => (
        <DropdownMenu
          key={label}
          modal={false}
          open={open === label}
          onOpenChange={(expanded) => {
            setOpen((current) => openMenuAfter(current, label, expanded));
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              role="menuitem"
              data-docs-menu-trigger
              tabIndex={tab === index ? 0 : -1}
              onFocus={() => setTab(index)}
              onPointerEnter={() => {
                if (open && open !== label) move(index, true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  lastItem.current = true;
                  setOpen(label);
                }
                if (
                  event.key.length === 1 &&
                  /\S/.test(event.key) &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                ) {
                  const next = MENUS.findIndex(
                    (menu, candidate) =>
                      candidate !== index && menu.toLowerCase().startsWith(event.key.toLowerCase()),
                  );
                  if (next >= 0) {
                    event.preventDefault();
                    move(next, false);
                  }
                }
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  move(
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? MENUS.length - 1
                        : index + (event.key === "ArrowRight" ? 1 : -1),
                    false,
                  );
                }
              }}
            >
              {label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="docs-editor-menu"
            onFocusCapture={() => {
              if (!lastItem.current) return;
              lastItem.current = false;
              // The content can hold non-item children (the shared inert-outside helper), so
              // take the last menu item rather than the content's last child.
              requestAnimationFrame(() =>
                [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-slot="dropdown-menu-content"] [role="menuitem"]',
                  ),
                ]
                  .at(-1)
                  ?.focus(),
              );
            }}
            onCloseAutoFocus={(event) => {
              if (switching.current.delete(label)) {
                event.preventDefault();
                return;
              }
              const run = pending.current;
              // Without a command, Radix restores the trigger after a keyboard close and
              // leaves focus where the person clicked or tabbed after an outside interaction.
              if (!run) return;
              event.preventDefault();
              pending.current = null;
              // Land on the durable trigger first: a dialog the command opens then
              // restores focus here when it closes, instead of to the removed item.
              trigger(index)?.focus();
              run();
            }}
            onKeyDown={(event) => {
              // Radix already handled keys that open or close a submenu (including
              // ArrowRight on a sub-trigger), and submenu keys belong to the submenu.
              if (
                event.defaultPrevented ||
                (event.target as HTMLElement).closest('[role="menu"]') !== event.currentTarget
              )
                return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                move(index + (event.key === "ArrowRight" ? 1 : -1), true);
              }
            }}
          >
            {contents[label]}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  );
}
