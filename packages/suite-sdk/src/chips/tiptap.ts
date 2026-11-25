// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { Node } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { type ChipRef, chipIri, chipKinds } from "./core.js";

/**
 * Person chips arriving by paste or by a drop from outside this editor become plain links (or
 * plain text when the schema has no `link` mark). Foreign HTML can forge chip anchors, and a
 * paste is a local transaction, so keeping them as chips would send mentions nobody typed.
 */
export function downgradePastedPeople(fragment: Fragment, schema: Schema): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name !== "chip") {
      nodes.push(node.isLeaf ? node : node.copy(downgradePastedPeople(node.content, schema)));
      return;
    }
    if (node.attrs.kind !== "person") {
      nodes.push(node);
      return;
    }
    const iri = String(node.attrs.iri);
    const text = String(node.attrs.label) || iri;
    if (!text) return;
    const link = schema.marks.link;
    nodes.push(schema.text(text, link && chipIri(iri) ? [link.create({ href: iri })] : []));
  });
  return Fragment.fromArray(nodes);
}

const pastedPeople = new PluginKey("chipPastedPeople");

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
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pastedPeople,
          props: {
            // view.dragging is set only while a drag that started in this editor moves content.
            transformPasted: (slice, view) =>
              view.dragging
                ? slice
                : new Slice(
                    downgradePastedPeople(slice.content, view.state.schema),
                    slice.openStart,
                    slice.openEnd,
                  ),
          },
        }),
      ];
    },
  });
}
