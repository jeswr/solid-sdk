// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { entities } from "./generated/model.js";

// Public declaration-only view: all accessors are installed by the generated
// entity. Explicit unions preserve clearing setters under exactOptionalPropertyTypes
// and keep mirror declarations independent of the bundled runtime's types.
interface MessageView extends TermWrapper {
  readonly types: Set<string>;
  readonly isInstance: boolean;
  mark(): this;
  content: string | undefined;
  mediaType: string | undefined;
  author: string | undefined;
  published: Date | undefined;
  room: string | undefined;
  inReplyTo: string | undefined;
  replacedBy: string | undefined;
  deletedAt: Date | undefined;
  provAttributedTo: string | undefined;
  provGeneratedBy: string | undefined;
  provDerivedFrom: string | undefined;
  taskTitle: string | undefined;
  assignee: string | undefined;
  identifier: string | undefined;
  role: string | undefined;
}
const Wrapper = entities.Message.Wrapper as new (
  term: string | Term,
  dataset: DatasetCore,
  factory: DataFactory,
) => MessageView;

/** Public accessor retained as a minimal view of the generated wrapper. */
export class As2MessageDoc extends Wrapper {
  markNote(): this {
    return this.mark();
  }
}
