// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-mail; original author credited below.
// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Claude Opus 5.5 (indexed find* lookups)
/**
 * `MailboxDataset` — a whole mail document wrapped as a `DatasetWrapper`.
 *
 * Messages, threads and folders are *sibling subjects* in a document (not
 * objects reachable from one root subject), so the document itself must be the
 * wrapper that enumerates them — exactly as the type-index skill prescribes for
 * `solid:TypeRegistration`. `instancesOf` is a protected helper on
 * `DatasetWrapper`, callable only from a subclass, which is why this class
 * exists rather than scanning quads by hand.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import { DatasetWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { Folder } from "./folder.js";
import { Message } from "./message.js";
import { Thread } from "./thread.js";
import { Classes } from "./vocab.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** A mail document (a container of message/thread/folder subjects). */
export class MailboxDataset extends DatasetWrapper {
  /** Every `schema:EmailMessage` subject in the document. */
  get messages(): Iterable<Message> {
    return this.usableInstancesOf(Classes.EmailMessage, Message);
  }

  /** Every conversation/thread subject in the document. */
  get threads(): Iterable<Thread> {
    return this.usableInstancesOf(Classes.Conversation, Thread);
  }

  /** Every folder/collection subject in the document. */
  get folders(): Iterable<Folder> {
    return this.usableInstancesOf(Classes.Folder, Folder);
  }

  /**
   * Like `instancesOf`, but a typed subject the generated wrapper refuses (a blank node
   * or an unsafe IRI) is skipped instead of aborting the whole enumeration, so one
   * malformed item in a pod document never hides the valid ones.
   */
  private *usableInstancesOf<T>(
    klass: string,
    Wrapper: new (subject: string, dataset: MailboxDataset, factory: typeof this.factory) => T,
  ): Iterable<T> {
    const seen = new Set<string>();
    for (const quad of this.match(
      undefined,
      this.factory.namedNode(RDF_TYPE),
      this.factory.namedNode(klass),
    )) {
      if (quad.subject.termType !== "NamedNode" || seen.has(quad.subject.value)) continue;
      seen.add(quad.subject.value);
      let wrapper: T;
      try {
        wrapper = new Wrapper(quad.subject.value, this, this.factory);
      } catch {
        continue;
      }
      yield wrapper;
    }
  }

  /**
   * The `usableInstancesOf` member whose IRI is `iri`, found by an indexed lookup
   * of its explicit type quad instead of enumerating (and wrapping) every instance,
   * so a find stays O(1) in the document size. Same acceptance rules: the subject must
   * carry the exact explicit type, and a subject the generated wrapper refuses is absent.
   */
  private usableInstance<T>(
    iri: string,
    klass: string,
    Wrapper: new (subject: string, dataset: MailboxDataset, factory: typeof this.factory) => T,
  ): T | undefined {
    const typed = this.match(
      this.factory.namedNode(iri),
      this.factory.namedNode(RDF_TYPE),
      this.factory.namedNode(klass),
    );
    if (typed.size === 0) return undefined;
    try {
      return new Wrapper(iri, this, this.factory);
    } catch {
      return undefined;
    }
  }

  /** Wrap (or mint) a message at the given subject IRI in this dataset. */
  message(iri: string): Message {
    return new Message(iri, this, this.factory);
  }

  /** Wrap (or mint) a thread at the given subject IRI in this dataset. */
  thread(iri: string): Thread {
    return new Thread(iri, this, this.factory);
  }

  /** Wrap (or mint) a folder at the given subject IRI in this dataset. */
  folder(iri: string): Folder {
    return new Folder(iri, this, this.factory);
  }

  /**
   * Mint a new message: create the subject, stamp its type, and return the
   * wrapper ready for field assignment. Persist via `serialiseToTurtle` + a
   * conditional PUT in the store layer.
   */
  createMessage(iri: string): Message {
    const m = this.message(iri);
    m.markMessage();
    return m;
  }

  /** Mint a new thread (stamped `schema:Conversation` + `sioc:Thread`). */
  createThread(iri: string): Thread {
    const t = this.thread(iri);
    t.markThread();
    return t;
  }

  /** Mint a new folder (stamped `schema:Collection`). */
  createFolder(iri: string): Folder {
    const f = this.folder(iri);
    f.markFolder();
    return f;
  }

  /** Find a single message by IRI, or undefined if not present. */
  findMessage(iri: string): Message | undefined {
    return this.usableInstance(iri, Classes.EmailMessage, Message);
  }

  /** Find a single thread by IRI, or undefined if not present. */
  findThread(iri: string): Thread | undefined {
    return this.usableInstance(iri, Classes.Conversation, Thread);
  }

  /** Find a single folder by IRI, or undefined if not present. */
  findFolder(iri: string): Folder | undefined {
    return this.usableInstance(iri, Classes.Folder, Folder);
  }
}

/** Parse a complete Turtle mail document without network I/O. */
export async function parseMailbox(text: string, url: string): Promise<MailboxDataset> {
  return new MailboxDataset(await parseRdf(text, "text/turtle", { baseIRI: url }), DataFactory);
}
