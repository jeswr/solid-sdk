// AUTHORED-BY Codex GPT-6.1-Sol
import { assertImportSize, BankImportError } from "./errors";
import type { ImportedTransaction } from "./types";
import { parseAmount, parseDate } from "./values";

interface Element {
  name: string;
  text: string;
  children: Element[];
}

const emptyLeaves = new Set(["NAME", "EXTDNAME", "MEMO", "FITID", "ACCTID", "CURDEF"]);
const entities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  const parts: string[] = [];
  let plainStart = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "&") continue;
    parts.push(value.slice(plainStart, i));
    const start = ++i;
    // Move only forward: malformed runs of ampersands never trigger overlapping searches.
    while (i < value.length && value[i] !== ";") {
      if (value[i] === "&" || /\s/.test(value[i] as string))
        throw new BankImportError("Malformed OFX entity");
      i++;
    }
    if (i === value.length) throw new BankImportError("Unterminated OFX entity");
    const name = value.slice(start, i);
    if (Object.hasOwn(entities, name)) parts.push(entities[name] as string);
    else {
      if (!/^#(?:\d+|x[\da-f]+)$/i.test(name)) throw new BankImportError("Unsupported OFX entity");
      const code =
        name[1]?.toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new BankImportError("Invalid OFX entity");
      parts.push(String.fromCodePoint(code));
    }
    plainStart = i + 1;
  }
  parts.push(value.slice(plainStart));
  return parts.join("");
}

/** A small inert OFX tree reader. It never resolves DTDs, external entities or URLs. */
function readTree(text: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new BankImportError("OFX declarations are unsupported");
  const sgml = /^\s*OFXHEADER:\s*1\d\d\b/i.test(text);
  const start = text.search(/<OFX(?:\s|>)/i);
  if (start < 0) throw new BankImportError("Missing OFX document");
  const source = text.slice(start).trim();
  const document: Element = { name: "DOCUMENT", text: "", children: [] };
  const stack = [document];
  const tokens = source.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g);
  let consumed = 0;
  for (const match of tokens) {
    if (match.index !== consumed) throw new BankImportError("Invalid OFX markup");
    const token = match[0];
    consumed += token.length;
    let parent = stack[stack.length - 1] as Element;
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("<![CDATA[")) {
      if (stack.length === 1) throw new BankImportError("Text outside OFX root");
      parent.text += token.slice(9, -3);
    } else if (token.startsWith("</")) {
      const closing = /^<\/([A-Z][A-Z0-9.]*)\s*>$/i.exec(token);
      if (!closing) throw new BankImportError("Invalid OFX closing tag");
      const name = (closing[1] as string).toUpperCase();
      if (sgml && parent.name !== name && parent.children.length === 0) {
        stack.pop();
        parent = stack[stack.length - 1] as Element;
      }
      if (stack.length === 1 || parent.name !== name)
        throw new BankImportError("Mismatched OFX tags");
      stack.pop();
    } else if (token.startsWith("<")) {
      const opening =
        /^<([A-Z][A-Z0-9.]*)(?:\s+[A-Z][\w:-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*(\/?)>$/i.exec(
          token,
        );
      if (!opening) throw new BankImportError("Invalid OFX opening tag");
      if (sgml && (parent.text.trim() || emptyLeaves.has(parent.name))) {
        stack.pop();
        parent = stack[stack.length - 1] as Element;
      }
      const node: Element = { name: (opening[1] as string).toUpperCase(), text: "", children: [] };
      parent.children.push(node);
      if (!opening[2]) stack.push(node);
    } else {
      if (stack.length === 1 && token.trim()) throw new BankImportError("Text outside OFX root");
      parent.text += decode(token);
    }
  }
  if (
    consumed !== source.length ||
    stack.length !== 1 ||
    document.children.length !== 1 ||
    document.children[0]?.name !== "OFX"
  ) {
    throw new BankImportError("Incomplete OFX document");
  }
  return document.children[0];
}

function field(node: Element, name: string): string {
  const matches = node.children.filter((child) => child.name === name);
  if (matches.length > 1 || matches.some((child) => child.children.length > 0))
    throw new BankImportError("Invalid OFX field");
  return matches[0]?.text.trim() ?? "";
}

function postingDate(value: string): string {
  // Keep the bank's posting calendar day, independent of the host time zone.
  const match =
    /^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?(?:\[[+-]?\d+(?:\.\d+)?(?::[^\]]+)?\])?)?$/.exec(
      value,
    );
  if (!match) throw new BankImportError("Invalid OFX posting date");
  return parseDate(`${match[1]}-${match[2]}-${match[3]}`, "YYYY-MM-DD");
}

function ofxAmount(value: string): string {
  // OFX uses either decimal separator and never permits thousands grouping.
  if (!/^[+-]?\d+(?:[.,]\d*)?$/.test(value)) throw new BankImportError("Invalid OFX amount");
  return parseAmount(value.replace(",", ".").replace(/\.$/, ""));
}

/** OFX/QFX 1.x SGML and 2.x XML bank/credit-card statements. Empty statements return []. */
export function importOfx(text: string): ImportedTransaction[] {
  assertImportSize(text);
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
      if (node.children.some((child) => child.name === "CURRENCY"))
        throw new BankImportError("OFX transaction currency overrides are unsupported");
      if (
        node.children.some(
          (child) => child.name === "CORRECTFITID" || child.name === "CORRECTACTION",
        )
      )
        throw new BankImportError("OFX transaction corrections are unsupported");
      const name = field(node, "NAME");
      const payees = node.children.filter((child) => child.name === "PAYEE");
      if (payees.length > 1 || payees.some((payee) => payee.text.trim()))
        throw new BankImportError("Invalid OFX payee");
      const payeeName = payees[0] ? field(payees[0], "NAME") : "";
      const extendedName = field(node, "EXTDNAME");
      const memo = field(node, "MEMO");
      const description = name || payeeName || extendedName || memo;
      if (!description) throw new BankImportError("Missing transaction description");
      const externalId = field(node, "FITID");
      transactions.push({
        date: postingDate(field(node, "DTPOSTED")),
        amount: ofxAmount(field(node, "TRNAMT")),
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
