// AUTHORED-BY Codex GPT-6.1-Sol
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | {
      readonly [key: string]: JsonValue;
    };
export interface DocumentMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, JsonValue>>;
}
export interface DocumentNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, JsonValue>>;
  readonly text?: string;
  readonly marks?: readonly DocumentMark[];
  readonly content?: readonly DocumentNode[];
}
/** Half-open positions relative to the start of the top-level block (PM node positions). */
export interface DiffRange {
  from: number;
  to: number;
}
export interface TextChange {
  kind: "inserted" | "deleted";
  before: DiffRange;
  after: DiffRange;
  text: string;
}
/** Only surviving text has mark changes; inserted/deleted text carries its marks in the block. */
export interface MarkChange {
  kind: "marks";
  before: DiffRange;
  after: DiffRange;
  removed: readonly DocumentMark[];
  added: readonly DocumentMark[];
}
export type BlockChange =
  | { kind: "inserted"; afterIndex: number; after: DocumentNode }
  | { kind: "deleted"; beforeIndex: number; before: DocumentNode }
  | {
      kind: "modified";
      beforeIndex: number;
      afterIndex: number;
      before: DocumentNode;
      after: DocumentNode;
      inline: (TextChange | MarkChange)[];
    };
