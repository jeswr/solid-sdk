import {
  TermWrapper,
  OptionalFrom,
  OptionalAs,
  SetFrom,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
} from "@rdfjs/wrapper";
import { WF, DCT, RDF, STATE, wf, dct, rdf } from "./vocab";

export type IssueState = "open" | "closed";

/**
 * A single issue, mapped onto `wf:Task` data. State is carried by `rdf:type`
 * (the SolidOS model — there is no `wf:state` predicate): an open issue is typed
 * `wf:Open`, a closed one `wf:Closed`. All access goes through typed accessors;
 * never assemble quads inline (AGENTS.md §Writing data).
 */
export class Issue extends TermWrapper {
  /** The issue's IRI (a fragment of its document). */
  get id(): string {
    return this.value;
  }

  /** rdf:type values as a live set — mutate to retype. */
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("description"), LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, wf("description"), value, LiteralFrom.string);
  }

  /** Back-link to the owning `wf:Tracker` (an IRI). */
  get tracker(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("tracker"), NamedNodeAs.string);
  }
  set tracker(value: string | undefined) {
    OptionalAs.object(this, wf("tracker"), value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }

  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
  }

  /** WebID of whoever filed the issue. */
  get creator(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("creator"), NamedNodeAs.string);
  }
  set creator(value: string | undefined) {
    OptionalAs.object(this, dct("creator"), value, NamedNodeFrom.string);
  }

  /** WebID of the assigned agent (optional). */
  get assignee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("assignee"), NamedNodeAs.string);
  }
  set assignee(value: string | undefined) {
    OptionalAs.object(this, wf("assignee"), value, NamedNodeFrom.string);
  }

  /** Due date (date only, no time). */
  get dateDue(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, wf("dateDue"), LiteralAs.date);
  }
  set dateDue(value: Date | undefined) {
    OptionalAs.object(this, wf("dateDue"), value, LiteralFrom.date);
  }

  get state(): IssueState {
    return this.types.has(STATE.Closed) ? "closed" : "open";
  }
  set state(value: IssueState) {
    const types = this.types;
    if (value === "closed") {
      types.add(STATE.Closed);
      types.delete(STATE.Open);
    } else {
      types.add(STATE.Open);
      types.delete(STATE.Closed);
    }
    // Every issue is always a wf:Task as well.
    types.add(wf("Task"));
  }

  get isOpen(): boolean {
    return this.state === "open";
  }
}

/**
 * The tracker configuration node (`wf:Tracker`). One per document; issues
 * back-link to it via `wf:tracker`.
 */
export class Tracker extends TermWrapper {
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  /** Write the fixed tracker configuration (type, issue class, initial state). */
  configure(title: string): void {
    this.types.add(wf("Tracker"));
    this.title = title;
    OptionalAs.object(this, wf("issueClass"), wf("Task"), NamedNodeFrom.string);
    OptionalAs.object(this, wf("initialState"), STATE.Open, NamedNodeFrom.string);
  }
}

export { WF, DCT, RDF, STATE };
