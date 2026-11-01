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
import { STYLE_RULES } from "../lib/editor/styles";

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
              default: 0,
              parseHTML: (element: HTMLElement) =>
                Math.min(8, Math.max(0, Number(element.dataset.indent) || 0)),
              renderHTML: (attrs: Record<string, unknown>) =>
                Number.isInteger(attrs.indent) &&
                Number(attrs.indent) > 0 &&
                Number(attrs.indent) <= 8
                  ? {
                      "data-indent": attrs.indent,
                      style: `margin-left: ${Number(attrs.indent) * 36}pt`,
                    }
                  : {},
            },
          },
        },
      ];
    },
  }),
];
