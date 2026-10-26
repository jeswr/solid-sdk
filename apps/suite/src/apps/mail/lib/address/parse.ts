// AUTHORED-BY Codex GPT-6.1-Sol
import { domainToASCII } from "./domain";
import { displayName, requireAddress, text } from "./errors";
import type { Address, MailboxAddress } from "./types";

const atom = /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+$/i;
const dotAtom = /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/i;

interface Token {
  kind: "word" | "quoted" | "symbol";
  value: string;
  start: number;
  end: number;
}

function tokens(input: string): Token[] {
  text(input);
  requireAddress(input.length <= 65_536);
  // Unfold only legal RFC 5322 FWS; preserve the following whitespace in quoted locals.
  const value = input.replace(/\r\n(?=[ \t])/g, "");
  requireAddress(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.replace(/\t/g, "")));
  const result: Token[] = [];
  let i = 0;
  while (i < value.length) {
    const start = i;
    const char = value.charAt(i++);
    if (char === " " || char === "\t") continue;
    if (char === "(") {
      let depth = 1;
      while (i < value.length && depth > 0) {
        const current = value.charAt(i++);
        if (current === "\\") {
          requireAddress(i < value.length, "invalid-syntax");
          i++;
        } else if (current === "(") {
          requireAddress(++depth <= 32, "unsupported-syntax");
        } else if (current === ")") depth--;
      }
      requireAddress(depth === 0, "invalid-syntax");
      continue;
    }
    if (char === '"') {
      let quoted = "";
      let closed = false;
      while (i < value.length) {
        const current = value.charAt(i++);
        if (current === '"') {
          closed = true;
          break;
        }
        if (current === "\\") {
          requireAddress(i < value.length, "invalid-syntax");
          quoted += value.charAt(i++);
        } else quoted += current;
      }
      requireAddress(closed, "invalid-syntax");
      result.push({ kind: "quoted", value: quoted, start, end: i });
    } else if ("<>@,;:.".includes(char)) {
      result.push({ kind: "symbol", value: char, start, end: i });
    } else {
      requireAddress(!/[[\]\\)]/.test(char), "unsupported-syntax");
      while (i < value.length && !/[ \t()<>@,;:."[\]\\]/.test(value.charAt(i))) i++;
      result.push({ kind: "word", value: value.slice(start, i), start, end: i });
    }
  }
  return result;
}

/** Canonical quoting removes equivalent quoted dot-atoms, retaining local-part case. */
export function quoteLocal(value: string): string {
  return dotAtom.test(value) ? value : `"${value.replace(/["\\]/g, "\\$&")}"`;
}

class Parser {
  private cursor = 0;
  constructor(private readonly input: Token[]) {}

  private peek(value: string): boolean {
    const token = this.input[this.cursor];
    return token?.kind === "symbol" && token.value === value;
  }

  private take(value: string): void {
    requireAddress(this.peek(value), "invalid-syntax");
    this.cursor++;
  }

  private phrase(until: number): string {
    const words = this.input.slice(this.cursor, until);
    requireAddress(
      words.length > 0 && words.every((token) => token.kind !== "symbol"),
      "invalid-syntax",
    );
    const name = words.map((token) => token.value).join(" ");
    displayName(name);
    this.cursor = until;
    return name;
  }

  private dotted(): string {
    const first = this.input[this.cursor++];
    requireAddress(first?.kind === "word", "invalid-syntax");
    let value = first.value;
    let end = first.end;
    while (this.peek(".")) {
      const dot = this.input[this.cursor++] as Token; // peek proved this token exists.
      const next = this.input[this.cursor++];
      requireAddress(
        dot.start === end && next?.kind === "word" && next.start === dot.end,
        "unsupported-syntax",
      );
      value += `.${next.value}`;
      end = next.end;
    }
    return value;
  }

  addrSpec(): string {
    const first = this.input[this.cursor];
    requireAddress(first, "invalid-syntax");
    let local: string;
    if (first.kind === "quoted") {
      this.cursor++;
      local = first.value;
      requireAddress(/^[\x20-\x7e\t]*$/.test(local), "unsupported-syntax");
    } else {
      local = this.dotted();
      requireAddress(
        local.split(".").every((part) => atom.test(part)),
        "unsupported-syntax",
      );
    }
    this.take("@");
    const domain = domainToASCII(this.dotted());
    const email = `${quoteLocal(local)}@${domain}`;
    requireAddress(local.length <= 64 && email.length <= 254, "invalid-recipient");
    return email;
  }

  private entry(allowGroup: false): MailboxAddress;
  private entry(allowGroup: true): Address;
  private entry(allowGroup: boolean): Address {
    let end = this.cursor;
    while (end < this.input.length && (this.input[end] as Token).kind !== "symbol") end++;
    const marker = this.input[end]?.value;
    if (marker === ":") {
      requireAddress(allowGroup, "unsupported-syntax");
      const name = this.phrase(end);
      this.take(":");
      const members: MailboxAddress[] = [];
      if (!this.peek(";")) {
        for (;;) {
          const member = this.entry(false);
          members.push(member);
          if (!this.peek(",")) break;
          this.take(",");
        }
      }
      this.take(";");
      return { kind: "group", name, members };
    }
    if (marker === "<") {
      const name = end > this.cursor ? this.phrase(end) : undefined;
      this.take("<");
      const email = this.addrSpec();
      this.take(">");
      return name === undefined ? { kind: "mailbox", email } : { kind: "mailbox", email, name };
    }
    return { kind: "mailbox", email: this.addrSpec() };
  }

  list(): Address[] {
    const result: Address[] = [];
    if (this.input.length === 0) return result;
    for (;;) {
      result.push(this.entry(true));
      if (this.cursor === this.input.length) return result;
      this.take(",");
    }
  }

  finish(): void {
    requireAddress(this.cursor === this.input.length, "invalid-syntax");
  }
}

/** Modern RFC 5322 lists with UTF-8 display names and IDN domains; see README for exclusions. */
export function parseAddressList(input: string): Address[] {
  return new Parser(tokens(input)).list();
}

/** Bare addr-spec only. No provider-specific plus-tag/dot stripping or local-case folding. */
export function normaliseAddress(input: string): string {
  const parser = new Parser(tokens(input));
  const result = parser.addrSpec();
  parser.finish();
  return result;
}
