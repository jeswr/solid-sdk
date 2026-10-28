// AUTHORED-BY Codex
import type { TagParseRule } from "@tiptap/pm/model";
import { flattenExtensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

const extensions = flattenExtensions([StarterKit.configure({ heading: { levels: [1, 2, 3] } })]);

// Markdown and the live editor must accept the same inline mark combinations.
// Code excludes no marks, so links and visual formatting can surround code.
export const compatibleCodeExtensions = extensions
  .filter((extension) => extension.name === "code")
  .map((extension) => extension.extend({ excludes: "" }));

// ProseMirror applies preserveWhitespace to node rules, not mark rules. Preserve
// the containing textblock so code at its edges and spaces beside code survive too.
export const codeWhitespaceTextblocks = extensions
  .filter((extension) => ["paragraph", "heading"].includes(extension.name))
  .map((extension) =>
    extension.extend({
      parseHTML(this: { parent: () => TagParseRule[] }) {
        return this.parent().flatMap((rule) => [
          { ...rule, tag: `${rule.tag}:has(code)`, preserveWhitespace: "full" as const },
          rule,
        ]);
      },
    }),
  );
