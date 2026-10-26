// AUTHORED-BY Codex GPT-6.1-Sol
import { escapeText, escapeUri, fold } from "./text";
import type { VCard, VCardField } from "./types";

function token(value: string): string {
  if (!/^[a-z\d-]+$/i.test(value)) throw new SyntaxError("Invalid vCard group or parameter name");
  return value;
}

function parameter(value: string, version: VCard["version"]): string {
  if (version === "4.0") {
    value = value
      .replace(/\^/g, "^^")
      .replace(/\r\n|\r|\n/g, "^n")
      .replace(/"/g, "^'");
  } else if (/["\r\n]/.test(value)) {
    throw new SyntaxError("Unsupported v3 parameter quote or newline");
  }
  return /[\s,:;]/.test(value) ? `"${value}"` : value;
}

function fieldLine(
  name: string,
  field: VCardField<unknown>,
  value: string,
  version: VCard["version"],
): string {
  let header = field.group === undefined ? name : `${token(field.group)}.${name}`;
  for (const [key, values] of Object.entries(field.parameters)) {
    token(key);
    const upper = key.toUpperCase();
    if (upper === "ENCODING" || upper === "CHARSET") continue;
    header += `;${upper}=${values.map((value) => parameter(value, version)).join(",")}`;
  }
  return `${header}:${value}`;
}

function uri(value: string, version: VCard["version"]): string {
  if (!/^[a-z][a-z\d+.-]*:[^\s]*$/i.test(value)) throw new SyntaxError("Invalid vCard URI");
  return escapeUri(value, version);
}

function serializeCard(card: VCard): string {
  if (card.version !== "3.0" && card.version !== "4.0")
    throw new SyntaxError("Unsupported vCard version");
  const lines = ["BEGIN:VCARD", `VERSION:${card.version}`, `FN:${escapeText(card.fn)}`];
  if (card.n)
    lines.push(
      `N:${[card.n.family, card.n.given, card.n.additional, card.n.prefixes, card.n.suffixes].map((part) => part.map(escapeText).join(",")).join(";")}`,
    );
  else if (card.version === "3.0") lines.push("N:;;;;");
  for (const email of card.emails)
    lines.push(fieldLine("EMAIL", email, escapeText(email.value), card.version));
  for (const tel of card.tels) {
    const isUri = tel.parameters.VALUE?.[0]?.toLowerCase() === "uri";
    lines.push(
      fieldLine(
        "TEL",
        tel,
        isUri ? uri(tel.value, card.version) : escapeText(tel.value),
        card.version,
      ),
    );
  }
  for (const address of card.addresses) {
    const a = address.value;
    const value = [a.poBox, a.extended, a.street, a.locality, a.region, a.postalCode, a.country]
      .map((part) => part.map(escapeText).join(","))
      .join(";");
    lines.push(fieldLine("ADR", address, value, card.version));
  }
  if (card.bday !== undefined) {
    const type = card.bdayValueType === undefined ? "" : `;VALUE=${token(card.bdayValueType)}`;
    lines.push(`BDAY${type}:${escapeText(card.bday)}`);
  }
  if (card.org !== undefined) lines.push(`ORG:${card.org.map(escapeText).join(";")}`);
  for (const [name, value] of [
    ["TITLE", card.title],
    ["NOTE", card.note],
  ] as const) {
    if (value !== undefined) lines.push(`${name}:${escapeText(value)}`);
  }
  if (card.photo !== undefined) lines.push(`PHOTO;VALUE=URI:${uri(card.photo, card.version)}`);
  if (card.categories.length) lines.push(`CATEGORIES:${card.categories.map(escapeText).join(",")}`);
  lines.push("END:VCARD");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Export each card in its own version, as UTF-8 text with CRLF and 75-octet folding. */
export function serializeVCards(cards: readonly VCard[]): string {
  return cards.map(serializeCard).join("");
}
