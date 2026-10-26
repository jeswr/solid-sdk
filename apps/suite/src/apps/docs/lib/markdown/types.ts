// AUTHORED-BY Codex GPT-6.1-Sol

/** TipTap / ProseMirror JSON; runtime validation also accepts untrusted JSON on export. */
export interface DocsNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocsNode[];
  text?: string;
  marks?: DocsMark[];
}
export interface DocsMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface MarkdownOptions {
  /** Default reject. Literal preserves the ENTIRE source in one unformatted paragraph. */
  unsupported?: "reject" | "literal";
}
export type MarkdownErrorCode = "invalid-input" | "unsupported" | "limit" | "unrepresentable";
export class MarkdownError extends Error {
  constructor(
    public readonly code: MarkdownErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarkdownError";
  }
}
