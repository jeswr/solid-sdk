// AUTHORED-BY Codex GPT-6.1-Sol
import type { ImportedTransaction } from "./types";
import { parseAmount, parseDate } from "./values";

interface Element {
  name: string;
  text: string;
  children: Element[];
}

const emptyLeaves = new Set(["NAME", "MEMO", "FITID", "ACCTID", "CURDEF"]);
const entities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  return value.replace(/&([^;\s]+);/g, (_entity, name: string) => {
    if (Object.hasOwn(entities, name)) return entities[name] as string;
    if (!/^#(?:\d+|x[\da-f]+)$/i.test(name)) throw new Error("Unsupported OFX entity");
    const code =
      name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      throw new Error("Invalid OFX entity");
    return String.fromCodePoint(code);
  });
}

/** A small inert OFX tree reader. It never resolves DTDs, external entities or URLs. */
function readTree(text: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("OFX declarations are unsupported");
  const sgml = /^\s*OFXHEADER:\s*1\d\d\b/i.test(text);
  const start = text.search(/<OFX(?:\s|>)/i);
  if (start < 0) throw new Error("Missing OFX document");
  const source = text.slice(start).trim();
  const document: Element = { name: "DOCUMENT", text: "", children: [] };
  const stack = [document];
  const tokens = source.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g);
  let consumed = 0;
  for (const match of tokens) {
    if (match.index !== consumed) throw new Error("Invalid OFX markup");
    const token = match[0];
    consumed += token.length;
    let parent = stack[stack.length - 1] as Element;
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("<![CDATA[")) {
      if (stack.length === 1) throw new Error("Text outside OFX root");
      parent.text += token.slice(9, -3);
    } else if (token.startsWith("</")) {
      const closing = /^<\/([A-Z][A-Z0-9]*)\s*>$/i.exec(token);
      if (!closing) throw new Error("Invalid OFX closing tag");
      const name = (closing[1] as string).toUpperCase();
      if (sgml && parent.name !== name && parent.children.length === 0) {
        stack.pop();
        parent = stack[stack.length - 1] as Element;
      }
      if (stack.length === 1 || parent.name !== name) throw new Error("Mismatched OFX tags");
      stack.pop();
    } else if (token.startsWith("<")) {
      const opening =
        /^<([A-Z][A-Z0-9]*)(?:\s+[A-Z][\w:-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*(\/?)>$/i.exec(
          token,
        );
      if (!opening) throw new Error("Invalid OFX opening tag");
      if (sgml && (parent.text.trim() || emptyLeaves.has(parent.name))) {
        stack.pop();
        parent = stack[stack.length - 1] as Element;
      }
      const node: Element = { name: (opening[1] as string).toUpperCase(), text: "", children: [] };
      parent.children.push(node);
      if (!opening[2]) stack.push(node);
    } else {
      if (stack.length === 1 && token.trim()) throw new Error("Text outside OFX root");
      parent.text += decode(token);
    }
  }
  if (
    consumed !== source.length ||
    stack.length !== 1 ||
    document.children.length !== 1 ||
    document.children[0]?.name !== "OFX"
  ) {
    throw new Error("Incomplete OFX document");
  }
  return document.children[0];
}

function field(node: Element, name: string): string {
  const matches = node.children.filter((child) => child.name === name);
  if (matches.length > 1 || matches.some((child) => child.children.length > 0))
    throw new Error("Invalid OFX field");
  return matches[0]?.text.trim() ?? "";
}

function postingDate(value: string): string {
  // Keep the bank's posting calendar day, independent of the host time zone.
  const match =
    /^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?(?:\[[+-]?\d+(?:\.\d+)?(?::[^\]]+)?\])?)?$/.exec(
      value,
    );
  if (!match) throw new Error("Invalid OFX posting date");
  return parseDate(`${match[1]}-${match[2]}-${match[3]}`, "YYYY-MM-DD");
}

/** OFX/QFX 1.x SGML and 2.x XML bank/credit-card statements. Empty statements return []. */
export function importOfx(text: string): ImportedTransaction[] {
  const root = readTree(text);
  const transactions: ImportedTransaction[] = [];
  const visit = (node: Element, currency: string, accountId: string) => {
    if (node.name === "STMTRS" || node.name === "CCSTMTRS") {
      currency = field(node, "CURDEF");
      const account = node.children.find(
        (child) => child.name === "BANKACCTFROM" || child.name === "CCACCTFROM",
      );
      accountId = account ? field(account, "ACCTID") : "";
    }
    if (node.name === "STMTTRN") {
      const name = field(node, "NAME");
      const memo = field(node, "MEMO");
      const description = name || memo;
      if (!description) throw new Error("Missing transaction description");
      const externalId = field(node, "FITID");
      transactions.push({
        date: postingDate(field(node, "DTPOSTED")),
        amount: parseAmount(field(node, "TRNAMT")),
        description,
        ...(currency ? { currency } : {}),
        ...(accountId ? { accountId } : {}),
        ...(externalId ? { externalId } : {}),
        ...(memo ? { memo } : {}),
      });
    } else for (const child of node.children) visit(child, currency, accountId);
  };
  visit(root, "", "");
  return transactions;
}
