// AUTHORED-BY Codex

import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Search,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
  WholeWord,
} from "lucide-react";
import type { SlashItem } from "../lib/editor/logic";
export interface EditorAction {
  label: string;
  icon: typeof Bold;
  keys: string;
  active?: boolean;
  run: () => void;
}
export function runSlash(editor: Editor, item: SlashItem, image: () => void) {
  const c = editor.chain().focus();
  switch (item) {
    case "Heading 1":
      c.toggleHeading({ level: 1 }).run();
      break;
    case "Heading 2":
      c.toggleHeading({ level: 2 }).run();
      break;
    case "Heading 3":
      c.toggleHeading({ level: 3 }).run();
      break;
    case "Bulleted list":
      c.toggleBulletList().run();
      break;
    case "Numbered list":
      c.toggleOrderedList().run();
      break;
    case "Checklist":
      c.toggleTaskList().run();
      break;
    case "Quote":
      c.toggleBlockquote().run();
      break;
    case "Code block":
      c.toggleCodeBlock().run();
      break;
    case "Table":
      c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      break;
    case "Image":
      image();
      break;
    case "Horizontal rule":
      c.setHorizontalRule().run();
      break;
    case "Date":
      c.insertContent(
        new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date()),
      ).run();
      break;
  }
}
export function editorActions(
  e: Editor,
  open: { link: () => void; image: () => void; find: () => void; count: () => void },
): EditorAction[] {
  const action = (
    label: string,
    icon: typeof Bold,
    keys: string,
    run: () => unknown,
    active?: boolean,
  ): EditorAction => ({
    label,
    icon,
    keys,
    run: () => {
      run();
    },
    ...(active !== undefined ? { active } : {}),
  });
  return [
    action("Undo", Undo2, "Mod+Z", () => e.chain().focus().undo().run()),
    action("Redo", Redo2, "Mod+Shift+Z", () => e.chain().focus().redo().run()),
    action("Bold", Bold, "Mod+B", () => e.chain().focus().toggleBold().run(), e.isActive("bold")),
    action(
      "Italic",
      Italic,
      "Mod+I",
      () => e.chain().focus().toggleItalic().run(),
      e.isActive("italic"),
    ),
    action(
      "Underline",
      Underline,
      "Mod+U",
      () => e.chain().focus().toggleUnderline().run(),
      e.isActive("underline"),
    ),
    action(
      "Strikethrough",
      Strikethrough,
      "Mod+Shift+X",
      () => e.chain().focus().toggleStrike().run(),
      e.isActive("strike"),
    ),
    action(
      "Highlight",
      Highlighter,
      "Mod+Shift+H",
      () => e.chain().focus().toggleHighlight().run(),
      e.isActive("highlight"),
    ),
    action("Link", Link, "Mod+K", open.link, e.isActive("link")),
    action("Insert image", ImagePlus, "", open.image),
    action("Insert table", Table2, "", () =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    ),
    action(
      "Bulleted list",
      List,
      "Mod+Shift+8",
      () => e.chain().focus().toggleBulletList().run(),
      e.isActive("bulletList"),
    ),
    action(
      "Numbered list",
      ListOrdered,
      "Mod+Shift+7",
      () => e.chain().focus().toggleOrderedList().run(),
      e.isActive("orderedList"),
    ),
    action(
      "Checklist",
      CheckSquare,
      "Mod+Shift+9",
      () => e.chain().focus().toggleTaskList().run(),
      e.isActive("taskList"),
    ),
    action("Align left", AlignLeft, "Mod+Shift+L", () =>
      e.chain().focus().setTextAlign("left").run(),
    ),
    action("Align centre", AlignCenter, "Mod+Shift+E", () =>
      e.chain().focus().setTextAlign("center").run(),
    ),
    action("Align right", AlignRight, "Mod+Shift+R", () =>
      e.chain().focus().setTextAlign("right").run(),
    ),
    action("Justify", AlignJustify, "Mod+Shift+J", () =>
      e.chain().focus().setTextAlign("justify").run(),
    ),
    action("Clear formatting", RemoveFormatting, "Mod+\\", () =>
      e.chain().focus().unsetAllMarks().clearNodes().run(),
    ),
    action(
      "Subscript",
      Subscript,
      "",
      () => e.chain().focus().toggleSubscript().run(),
      e.isActive("subscript"),
    ),
    action(
      "Superscript",
      Superscript,
      "",
      () => e.chain().focus().toggleSuperscript().run(),
      e.isActive("superscript"),
    ),
    action("Horizontal rule", Minus, "", () => e.chain().focus().setHorizontalRule().run()),
    action("Find and replace", Search, "Mod+F", open.find),
    action("Word count", WholeWord, "Mod+Shift+C", open.count),
    action("Normal text", Pilcrow, "Mod+Alt+0", () => e.chain().focus().setParagraph().run()),
    action("Heading 1", Heading1, "Mod+Alt+1", () =>
      e.chain().focus().toggleHeading({ level: 1 }).run(),
    ),
    action("Heading 2", Heading2, "Mod+Alt+2", () =>
      e.chain().focus().toggleHeading({ level: 2 }).run(),
    ),
    action("Heading 3", Heading3, "Mod+Alt+3", () =>
      e.chain().focus().toggleHeading({ level: 3 }).run(),
    ),
    action("Quote", Quote, "Mod+Shift+B", () => e.chain().focus().toggleBlockquote().run()),
    action("Code block", SquareCode, "Mod+Alt+C", () => e.chain().focus().toggleCodeBlock().run()),
    action(
      "Inline code",
      Code,
      "Mod+E",
      () => e.chain().focus().toggleCode().run(),
      e.isActive("code"),
    ),
  ];
}
