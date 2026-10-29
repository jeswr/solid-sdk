// AUTHORED-BY Codex GPT-6.1-Sol

/** Indexes into successive `content` arrays; [] denotes the document. */
export type NodePath = readonly number[];

/** All projection offsets are Unicode code points, with an exclusive end. */
export interface NodeTextRange {
  readonly path: NodePath;
  readonly start: number;
  readonly end: number;
}

export interface TextSpan extends NodeTextRange {
  /** Separators belong to the container, not to an editable text node. */
  readonly kind: "text" | "hardBreak" | "separator";
}

export interface PlainTextProjection {
  readonly text: string;
  /** Nonempty, contiguous spans covering the entire projection in order. */
  readonly spans: readonly TextSpan[];
  /** Preorder ranges for every node, including empty nodes and containers. */
  readonly nodes: readonly NodeTextRange[];
}

export interface OutlineHeading extends NodeTextRange {
  readonly level: 1 | 2 | 3;
  /** Whitespace collapsed for the outline label only. */
  readonly text: string;
  /** Fragment identifier without the leading #. */
  readonly anchor: string;
  readonly children: readonly OutlineHeading[];
}

export interface DocumentStatistics {
  readonly words: number;
  readonly characters: number;
  readonly charactersWithoutSpaces: number;
  /** Exact fractional minutes at 230 words per minute; zero for no words. */
  readonly readingTimeMinutes: number;
}

export interface DocumentAnalysis {
  readonly projection: PlainTextProjection;
  readonly outline: readonly OutlineHeading[];
  readonly statistics: DocumentStatistics;
}

export type DocumentOutlineErrorCode =
  | "invalid-document"
  | "unsupported-node"
  | "unsupported-mark"
  | "limit-exceeded"
  | "invalid-locale"
  | "segmenter-unavailable";

export class DocumentOutlineError extends Error {
  readonly name = "DocumentOutlineError";

  constructor(
    readonly code: DocumentOutlineErrorCode,
    message: string,
    readonly path: NodePath = [],
  ) {
    super(message);
  }
}
