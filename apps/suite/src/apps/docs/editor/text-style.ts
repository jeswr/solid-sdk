// AUTHORED-BY Codex
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  LineHeight,
  TextStyle,
} from "@tiptap/extension-text-style";
import { type CommandProps, Extension } from "@tiptap/react";
import { INDENT_STEP_PT, indentFromMargin, indentLevel, STYLE_RULES } from "../lib/editor/styles";

function attributes(keys: (keyof typeof STYLE_RULES)[]) {
  return Object.fromEntries(
    keys.map((key) => {
      const rule = STYLE_RULES[key];
      return [
        key,
        {
          default: null,
          parseHTML: (element: HTMLElement) => {
            let current: HTMLElement | null = element;
            while (current) {
              const value = current.style.getPropertyValue(rule.css);
              if (value) return rule.sanitise(value);
              if (!["fontFamily", "fontSize", "color", "backgroundColor"].includes(key)) break;
              current = current.parentElement;
            }
            return null;
          },
          renderHTML: (attrs: Record<string, unknown>) => {
            const value = rule.sanitise(attrs[key]);
            return value ? { style: `${rule.css}: ${value}` } : {};
          },
        },
      ];
    }),
  );
}

export const textStyleExtensions = [
  TextStyle.extend({
    parseHTML() {
      return ["span", "p", "h1", "h2", "h3", "li"].map((tag) => ({
        tag,
        consuming: false,
        getAttrs: (element: HTMLElement) => (element.hasAttribute("style") ? {} : false),
      }));
    },
  }),
  ...[
    [FontFamily, "fontFamily"],
    [FontSize, "fontSize"],
    [Color, "color"],
    [BackgroundColor, "backgroundColor"],
  ].map(([extension, key]) =>
    (extension as typeof FontFamily).extend({
      addGlobalAttributes() {
        return [
          { types: ["textStyle"], attributes: attributes([key as keyof typeof STYLE_RULES]) },
        ];
      },
    }),
  ),
  LineHeight.extend({
    addGlobalAttributes() {
      return [{ types: ["paragraph", "heading"], attributes: attributes(["lineHeight"]) }];
    },
    addCommands() {
      return {
        setLineHeight:
          (value: string) =>
          ({ chain }: CommandProps) =>
            chain()
              .updateAttributes("paragraph", { lineHeight: value })
              .updateAttributes("heading", { lineHeight: value })
              .run(),
        unsetLineHeight:
          () =>
          ({ chain }: CommandProps) =>
            chain()
              .resetAttributes("paragraph", "lineHeight")
              .resetAttributes("heading", "lineHeight")
              .run(),
      };
    },
  }),
  Extension.create({
    name: "docsParagraphLayout",
    addGlobalAttributes() {
      return [
        {
          types: ["paragraph", "heading"],
          attributes: {
            ...attributes(["spaceBefore", "spaceAfter"]),
            indent: {
              default: null,
              // The data attribute is the suite's own; margin-left is how Word,
              // Google Docs and the suite's HTML export carry an indent.
              parseHTML: (element: HTMLElement) =>
                indentLevel(element.dataset.indent) ??
                indentFromMargin(element.style.getPropertyValue("margin-left")),
              renderHTML: (attrs: Record<string, unknown>) => {
                const level = indentLevel(attrs.indent);
                return level
                  ? { "data-indent": level, style: `margin-left: ${level * INDENT_STEP_PT}pt` }
                  : {};
              },
            },
          },
        },
      ];
    },
  }),
];
