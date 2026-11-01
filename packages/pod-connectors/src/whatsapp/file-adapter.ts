// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * WhatsApp → Social & interests (Tier-C file import).
 *
 * WhatsApp's "Export chat (without media)" produces a `.txt` transcript, one
 * message per line in one of two locale shapes:
 *
 *   `[14/02/2023, 09:30:15] Alice: Hello there`        (iOS, bracketed)
 *   `2/14/23, 9:30 AM - Alice: Hello there`            (Android, dash)
 *
 * Continuation lines (a multi-line message) belong to the previous message. We
 * parse natively and write each message as a `schema:Message` in Social, with
 * the sender name as a literal (never an invented IRI) and the timestamp as
 * `dateCreated`. System lines without a `Sender:` (e.g. "Messages and calls are
 * end-to-end encrypted") are skipped.
 */
import { DataFactory, Store } from "n3";
import { ChunkSlices } from "../core/chunk-slices.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { fileText, textLines } from "../core/file-stream.js";
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { CLASSES, Message } from "../core/vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "whatsapp";

const metadata: IntegrationMetadata = {
  id: ID,
  name: "WhatsApp",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["social"],
  whatYouGet: "Your exported chat history, saved as messages in Social & interests.",
  requirements: [],
};

export interface ChatMessage {
  readonly when?: Date;
  readonly sender: string;
  readonly text: string;
}

export const whatsappFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".txt,text/plain",
  fileHint:
    "In WhatsApp, open a chat → ⋯ → More → Export chat → Without media. Select the resulting _chat.txt.",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your chat…", done: 0, total: 1 });

    const doc = ctx.resolve("social/whatsapp-chat.ttl");
    const store = new Store();
    let i = 0;
    for await (const msg of streamWhatsappChat(file, ctx.skip)) {
      if (i >= ctx.maxRows) break;
      const key = `${i}|${msg.sender}|${msg.when?.toISOString() ?? ""}`;
      const frag = recordFragment(msg.sender, key);
      const m = new Message(`${doc}#msg-${frag}`, store, DataFactory).mark();
      m.sender = msg.sender;
      m.text = msg.text;
      if (msg.when) m.dateCreated = msg.when;
      i++;
    }

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    if (store.size === 0) return;
    await ctx.write({
      slug: "social/whatsapp-chat.ttl",
      category: "social",
      forClass: CLASSES.Message,
      dataset: store,
    });
  },
};

// `[14/02/2023, 09:30:15] Alice: Hi`  — iOS bracketed form.
const IOS =
  /^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?\]\s*([^:]+):\s?([\s\S]*)$/;
// `2/14/23, 9:30 AM - Alice: Hi`  — Android dash form.
const ANDROID =
  /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?\s+-\s+([^:]+):\s?([\s\S]*)$/;

export const MAX_WHATSAPP_MESSAGE_BYTES = 1024 * 1024;
export const MAX_WHATSAPP_CONTINUATION_LINES = 10_000;

/** Parse an already decoded transcript with the same bounded message builder. */
export function parseWhatsappChat(text: string, limit = Number.POSITIVE_INFINITY): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (limit <= 0) return out;
  const parser = new WhatsappChatParser();
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== "\r" && text[i] !== "\n") continue;
    const message = parser.push(text.slice(start, i));
    if (message) {
      out.push(message);
      if (out.length >= limit) return out;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
    start = i + 1;
  }
  const last = parser.finish();
  if (last) out.push(last);
  return out;
}

/** Coalesce continuation slices and release them immediately on either cap.
 * Count UTF-8 source bytes, including the timestamp/sender and one LF between
 * lines. An overflow counts once, then ignores input until the next timestamp.
 */
class WhatsappChatParser {
  private current:
    | { when?: Date; sender: string; parts: ChunkSlices; bytes: number; continuations: number }
    | undefined;
  private discarding = false;

  constructor(private readonly onSkip: () => void = () => {}) {}

  push(line: string): ChatMessage | undefined {
    // Strip the LRM/bidi marks WhatsApp sometimes prepends.
    const clean = line.replace(/^[‎‏‪-‮]+/, "");
    const match = clean.match(IOS) ?? clean.match(ANDROID);
    if (match) {
      const previous = this.finish();
      const [, a = "", b = "", y = "", h = "", mi = "", s, ampm, sender = "", body = ""] = match;
      this.discarding = false;
      this.current = {
        when: buildDate(a, b, y, h, mi, s, ampm),
        sender: sender.trim(),
        parts: new ChunkSlices(),
        bytes: 0,
        continuations: 0,
      };
      this.append(line, body, false);
      return previous;
    }
    this.append(line, clean, true);
    return undefined;
  }

  private append(raw: string, text: string, continuation: boolean): void {
    const current = this.current;
    if (!current) return;
    if (continuation) {
      if (++current.continuations > MAX_WHATSAPP_CONTINUATION_LINES) {
        this.discard();
        return;
      }
      current.bytes++;
    }
    for (let i = 0; i < raw.length; i++) {
      const code = raw.codePointAt(i) as number;
      current.bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (code > 0xffff) i++;
    }
    if (current.bytes > MAX_WHATSAPP_MESSAGE_BYTES) {
      this.discard();
      return;
    }
    if (continuation) current.parts.push("\n");
    current.parts.push(text);
  }

  discard(): void {
    this.current = undefined;
    if (!this.discarding) this.onSkip();
    this.discarding = true;
  }

  finish(): ChatMessage | undefined {
    const current = this.current;
    this.current = undefined;
    if (current) return { when: current.when, sender: current.sender, text: current.parts.text() };
    return undefined;
  }
}

/** Construct each message once, without joining and reparsing the transcript. */
async function* streamWhatsappChat(
  file: ImportFile,
  onSkip: () => void,
): AsyncGenerator<ChatMessage> {
  const parser = new WhatsappChatParser(onSkip);
  for await (const line of textLines(fileText(file), () => {
    // A missing line may contain a timestamp: discard the pending message and
    // its continuations until a complete timestamp supplies a safe boundary.
    parser.discard();
  })) {
    const message = parser.push(line);
    if (message) yield message;
  }
  const last = parser.finish();
  if (last) yield last;
}

function buildDate(
  a: string,
  b: string,
  y: string,
  h: string,
  mi: string,
  s: string | undefined,
  ampm: string | undefined,
): Date | undefined {
  let year = Number(y);
  if (year < 100) year += 2000;
  // Day-first vs month-first is locale-dependent; prefer D/M when the first
  // part can't be a month, else assume the bracketed iOS D/M default.
  let day = Number(a);
  let month = Number(b);
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  let hour = Number(h);
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const d = new Date(Date.UTC(year, month - 1, day, hour, Number(mi), s ? Number(s) : 0));
  return Number.isNaN(d.getTime()) ? undefined : d;
}
