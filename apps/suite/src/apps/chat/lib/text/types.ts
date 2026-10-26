// AUTHORED-BY Codex GPT-6.1-Sol
/** Text values are literal strings: render as text nodes, never as HTML. */
export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold" | "italic"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; label: string }
  | { type: "mention"; label: string; webId: string | null }
  | { type: "emoji"; shortcode: string; value: string };

export type BlockNode =
  | { type: "paragraph" | "quote"; children: InlineNode[] }
  | { type: "codeBlock"; language: string | null; value: string }
  | { type: "list"; ordered: boolean; start: number; items: InlineNode[][] };

export interface TextOptions {
  /** Case-sensitive handles mapped to HTTP(S) WebIDs; no profile lookup occurs. */
  mentions?: Readonly<Record<string, string>>;
}

export interface ChatMessage {
  author: string;
  /** Epoch milliseconds. Invalid values force a group boundary. */
  timestamp: number;
}

export interface MessageGroup<T extends ChatMessage> {
  author: string;
  messages: T[];
}
