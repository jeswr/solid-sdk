// AUTHORED-BY Codex
/** Portable document styles. Only these values cross the clipboard/import boundary. */
export const FONT_FAMILIES = [
  { label: "Suite default", value: "var(--font-ui)" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
] as const;

// Fixed document-ink tokens: unlike chrome tokens, these must stay the same on every
// device and theme, including in Word. rgb values avoid runtime theme dependencies.
export const documentRgb = (channels: readonly number[]) => `rgb${"("}${channels.join(", ")})`;
export const DOCUMENT_COLOURS = [
  { label: "Black", value: documentRgb([0, 0, 0]) },
  { label: "Grey", value: documentRgb([95, 99, 104]) },
  { label: "White", value: documentRgb([255, 255, 255]) },
  { label: "Red", value: documentRgb([192, 0, 0]) },
  { label: "Orange", value: documentRgb([230, 120, 0]) },
  { label: "Yellow", value: documentRgb([255, 230, 120]) },
  { label: "Green", value: documentRgb([24, 128, 56]) },
  { label: "Teal", value: documentRgb([0, 109, 119]) },
  { label: "Blue", value: documentRgb([26, 115, 232]) },
  { label: "Purple", value: documentRgb([126, 63, 160]) },
  { label: "Pink", value: documentRgb([244, 180, 205]) },
  { label: "Light blue", value: documentRgb([196, 224, 255]) },
] as const;

export function fontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value
    .trim()
    .replace(/["']/g, "")
    .replace(/\s*,\s*/g, ",")
    .toLowerCase();
  const family = FONT_FAMILIES.find((family) =>
    [family.label, family.value].some(
      (name) =>
        name
          .replace(/["']/g, "")
          .replace(/\s*,\s*/g, ",")
          .toLowerCase() === key,
    ),
  );
  return family?.value ?? null;
}

export function fontSize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)(pt|px)?$/i.exec(value.trim());
  if (!match) return null;
  const points = Number(match[1]) * (match[2]?.toLowerCase() === "px" ? 0.75 : 1);
  return points >= 6 && points <= 96 ? `${Math.round(points * 100) / 100}pt` : null;
}

export function colour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(input);
  if (hex) {
    const digits = hex[1] as string;
    const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
    return documentRgb(
      [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)),
    );
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(input);
  if (!rgb) return null;
  const channels = rgb.slice(1).map(Number);
  return channels.every((channel) => channel <= 255) ? documentRgb(channels) : null;
}

export function colourHex(value: unknown): string | null {
  const safe = colour(value);
  return safe
    ? (safe.match(/\d+/g) as string[])
        .map((part) => Number(part).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    : null;
}

export function lineHeight(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return number >= 1 && number <= 3 ? String(number) : null;
}

export function paragraphSpace(value: unknown): string | null {
  return typeof value === "string" && /^(0|6|8|12|18|24)pt$/.test(value) ? value : null;
}

export const STYLE_RULES = {
  fontFamily: { css: "font-family", sanitise: fontFamily },
  fontSize: { css: "font-size", sanitise: fontSize },
  color: { css: "color", sanitise: colour },
  backgroundColor: { css: "background-color", sanitise: colour },
  lineHeight: { css: "line-height", sanitise: lineHeight },
  spaceBefore: { css: "margin-top", sanitise: paragraphSpace },
  spaceAfter: { css: "margin-bottom", sanitise: paragraphSpace },
} as const;

export function sanitiseStyles(source: string): string {
  const declarations = new Map<string, string>();
  for (const declaration of source.split(";")) {
    const colon = declaration.indexOf(":");
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const rule = Object.values(STYLE_RULES).find((rule) => rule.css === name);
    const value = rule?.sanitise(declaration.slice(colon + 1).trim());
    if (value) declarations.set(name, value);
  }
  return [...declarations].map(([name, value]) => `${name}: ${value}`).join("; ");
}

export function sanitiseStyleAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [
      key,
      Object.hasOwn(STYLE_RULES, key)
        ? STYLE_RULES[key as keyof typeof STYLE_RULES].sanitise(value)
        : value,
    ]),
  );
}
