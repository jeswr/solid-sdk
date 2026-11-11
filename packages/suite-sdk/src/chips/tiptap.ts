// AUTHORED-BY Codex GPT-6.1-Sol
import { Node } from "@tiptap/core";
import { type ChipRef, chipIri, chipKinds } from "./core.js";

/** An atom with a normal anchor fallback. The factory has no React or app dependencies. */
export function createChipExtension() {
  return Node.create({
    name: "chip",
    priority: 1100,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    marks: "",
    addAttributes() {
      return {
        iri: { default: "", parseHTML: (element) => element.getAttribute("href"), rendered: false },
        kind: {
          default: "link",
          parseHTML: (element) => element.getAttribute("data-chip-kind"),
          rendered: false,
        },
        label: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-chip-label") ?? element.textContent,
          rendered: false,
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: "a[data-chip]",
          priority: 1100,
          getAttrs: (element) =>
            chipIri(element.getAttribute("href") ?? "") &&
            chipKinds.includes(element.getAttribute("data-chip-kind") as ChipRef["kind"])
              ? null
              : false,
        },
      ];
    },
    renderHTML({ node }) {
      const ref = node.attrs as ChipRef;
      if (!chipIri(ref.iri)) return ["span", {}, ref.label];
      return [
        "a",
        {
          href: ref.iri,
          "data-chip": "",
          "data-chip-kind": ref.kind,
          "data-chip-label": ref.label,
          rel: "noopener noreferrer",
        },
        ref.label,
      ];
    },
    renderText({ node }) {
      return String(node.attrs.label);
    },
  });
}
