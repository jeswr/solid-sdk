// AUTHORED-BY Claude Opus 4.8
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
import { DatasetWrapper } from "@rdfjs/wrapper";
import { Folder } from "./folder.js";
import { Message } from "./message.js";
import { Thread } from "./thread.js";
import { Classes } from "./vocab.js";

/** A mail document (a container of message/thread/folder subjects). */
export class MailboxDataset extends DatasetWrapper {
  /** Every `schema:EmailMessage` subject in the document. */
  get messages(): Iterable<Message> {
    return this.instancesOf(Classes.EmailMessage, Message);
  }

  /** Every conversation/thread subject in the document. */
  get threads(): Iterable<Thread> {
    return this.instancesOf(Classes.Conversation, Thread);
  }

  /** Every folder/collection subject in the document. */
  get folders(): Iterable<Folder> {
    return this.instancesOf(Classes.Folder, Folder);
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
    for (const m of this.messages) {
      if (m.value === iri) return m;
    }
    return undefined;
  }

  /** Find a single thread by IRI, or undefined if not present. */
  findThread(iri: string): Thread | undefined {
    for (const t of this.threads) {
      if (t.value === iri) return t;
    }
    return undefined;
  }

  /** Find a single folder by IRI, or undefined if not present. */
  findFolder(iri: string): Folder | undefined {
    for (const f of this.folders) {
      if (f.value === iri) return f;
    }
    return undefined;
  }
}
