// AUTHORED-BY Codex
"use client";
import { Button } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { focusDocument } from "../editor/focus";
import { buildOutline, type OutlineHeading } from "../lib/outline";
export function OutlinePane({ editor, revision }: { editor: Editor | null; revision: number }) {
  const [active, setActive] = useState("");
  const headings: OutlineHeading[] = [];
  const flatten = (items: readonly OutlineHeading[]) => {
    for (const item of items) {
      headings.push(item);
      flatten(item.children);
    }
  };
  if (editor) {
    try {
      flatten(buildOutline(editor.getJSON()));
    } catch {
      /* Unsupported content has no outline. */
    }
  }
  const anchors = headings.map((h) => h.anchor).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision updates heading DOM positions
  useEffect(() => {
    if (!editor) return;
    const elements = [...editor.view.dom.querySelectorAll("h1,h2,h3")];
    anchors.split(" ").forEach((anchor, i) => {
      const element = elements[i];
      if (element) element.id = `docs-${anchor}`;
    });
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries.find((entry) => entry.isIntersecting);
        if (first) setActive(first.target.id);
      },
      { root: editor.view.dom.closest(".ish-main"), rootMargin: "-10% 0px -60% 0px" },
    );
    elements.forEach((element) => {
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [editor, anchors, revision]);
  return (
    <div className="docs-outline">
      <p className="docs-eyebrow">IN THIS DOCUMENT</p>
      <h2>Outline</h2>
      <nav aria-label="Document outline">
        {headings.length ? (
          headings.map((heading, index) => (
            <Button
              key={heading.anchor}
              variant="ghost"
              style={{ paddingInlineStart: 12 + (heading.level - 1) * 12 }}
              aria-current={active === `docs-${heading.anchor}` ? "location" : undefined}
              onClick={() => {
                if (!editor) return;
                // ProseMirror can replace the heading DOM after the effect assigned IDs.
                const element = editor.view.dom.querySelectorAll("h1,h2,h3")[index];
                element?.scrollIntoView({ block: "center" });
                if (element) {
                  editor.commands.setTextSelection(editor.view.posAtDOM(element, 0));
                  focusDocument(editor, { scrollIntoView: false });
                }
              }}
            >
              {heading.text || "Untitled heading"}
            </Button>
          ))
        ) : (
          <p>Headings you add will appear here.</p>
        )}
      </nav>
    </div>
  );
}
