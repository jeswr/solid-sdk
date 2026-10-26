// AUTHORED-BY Codex GPT-6.1-Sol
export type EmptyAttributes = Readonly<Record<string, never>>;
export interface LinkAttributes {
  readonly href: string;
  readonly target?: string | null;
  readonly rel?: string | null;
  readonly class?: string | null;
  readonly title?: string | null;
}
export type NotesMark =
  | { readonly type: "bold" | "italic"; readonly attrs?: EmptyAttributes }
  | { readonly type: "link"; readonly attrs: LinkAttributes };
export interface NotesText {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly NotesMark[];
}
export type NotesTextBlock =
  | {
      readonly type: "paragraph";
      readonly attrs?: EmptyAttributes;
      readonly content?: readonly NotesText[];
    }
  | {
      readonly type: "heading";
      readonly attrs: { readonly level: 1 | 2 | 3 };
      readonly content?: readonly NotesText[];
    };
export interface NotesListItem {
  readonly type: "listItem";
  readonly attrs?: EmptyAttributes;
  readonly content: readonly NotesBlock[];
}
export interface NotesTaskItem {
  readonly type: "taskItem";
  readonly attrs: { readonly checked: boolean };
  readonly content: readonly NotesBlock[];
}
export type NotesList =
  | {
      readonly type: "bulletList";
      readonly attrs?: EmptyAttributes;
      readonly content: readonly NotesListItem[];
    }
  | {
      readonly type: "orderedList";
      readonly attrs?: { readonly start?: number };
      readonly content: readonly NotesListItem[];
    }
  | {
      readonly type: "taskList";
      readonly attrs?: EmptyAttributes;
      readonly content: readonly NotesTaskItem[];
    };
export type NotesBlock = NotesTextBlock | NotesList;
export interface NotesDocument {
  readonly type: "doc";
  readonly attrs?: EmptyAttributes;
  readonly content: readonly NotesBlock[];
}
/** The losslessly representable subset of the Docs editor's ProseMirror JSON. */
export type DocsDocument = NotesDocument;
