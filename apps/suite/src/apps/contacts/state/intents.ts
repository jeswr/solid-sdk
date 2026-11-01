// AUTHORED-BY Codex GPT-6.1-Sol
import type { ContactsModel } from "../lib/model/book";
import { registerAddressBook } from "../lib/model/discovery";
import {
  absentOr,
  ensureDeleted,
  ensurePerson,
  membership,
  openDocument,
  personLink,
  type SavedDocument,
} from "../lib/model/intent";
import { PartialWriteError } from "../lib/model/transport";
import type { Intent, IntentJournal } from "./journal";
import { ensureBook, ensurePrivateIndex } from "./recovery";

export interface DeleteToken {
  person: SavedDocument;
  labels: string[];
}
export function newIntent(
  kind: Intent["kind"],
  bookUrl: string,
  destination: string,
  details: Partial<Pick<Intent, "person" | "source" | "labels" | "destinations">> = {},
): Intent {
  return {
    id: crypto.randomUUID(),
    kind,
    bookUrl,
    destination,
    destinations: [destination],
    startedAt: new Date().toISOString(),
    completed: [],
    repairs: [],
    labels: [],
    phase: "forward",
    ...details,
  };
}

/** All multi-document operations use the same durable checkpoint/replay lifecycle. */
export class IntentRunner {
  constructor(
    private model: ContactsModel,
    private webId: string,
    private deleted: (token: DeleteToken) => void,
  ) {}
  async run(journal: IntentJournal, intent: Intent): Promise<void> {
    const checkpoint = (step: string) => {
      if (!intent.completed.includes(step)) intent.completed.push(step);
      if (/^https?:/.test(step) && !intent.destinations.includes(step))
        intent.destinations.push(step);
      delete intent.attempting;
      journal.put(intent);
    };
    const step = async (name: string, work: () => Promise<unknown>) => {
      if (intent.completed.includes(name)) return;
      intent.attempting = name;
      journal.put(intent); // Also covers an acknowledged effect whose response is lost.
      await work();
      checkpoint(name);
    };
    try {
      if (!intent.completed.includes("done")) {
        if (intent.kind === "book") {
          await step("book", async () => {
            if (!(await absentOr(() => this.model.loadAddressBook(intent.bookUrl))))
              await ensureBook(this.model, this.webId, checkpoint);
          });
          // Re-read the pointers even if bootstrapping was confirmed before a reload.
          const index = await ensurePrivateIndex(this.model, this.webId, checkpoint);
          intent.destination = index;
          journal.put(intent);
          await step("registration", () =>
            registerAddressBook(this.model, index, checkpoint, intent.bookUrl),
          );
        } else {
          const saved = intent.person as SavedDocument;
          const person = await openDocument(saved);
          const id = `${saved.url}#this`;
          if (intent.kind === "delete") {
            if (intent.phase === "reconcile") {
              const surviving = await absentOr(() => this.model.loadContact(saved.url));
              intent.phase = surviving ? "rollback" : "forward";
              intent.repairs = [...intent.completed];
              if (intent.attempting) intent.repairs.push(intent.attempting);
              journal.put(intent);
            }
            if (intent.phase === "rollback") {
              const surviving = await absentOr(() => this.model.loadContact(saved.url));
              if (surviving) {
                // Only repair removals we performed or may have performed. Merge current RDF.
                const removed = new Set(intent.repairs);
                if (removed.has("index"))
                  await step("repair:index", () =>
                    personLink(this.model, intent.bookUrl, surviving, true),
                  );
                for (const label of intent.labels) {
                  if (removed.has(label))
                    await step(`repair:${label}`, () =>
                      membership(this.model, intent.bookUrl, label, id, true),
                    );
                }
                checkpoint("rolled-back");
              } else {
                // A DELETE can finish after a failed response and the first reconciliation.
                intent.phase = "forward";
                journal.put(intent);
              }
            }
            if (intent.phase === "forward") {
              for (const label of intent.labels)
                await step(label, () => membership(this.model, intent.bookUrl, label, id, false));
              await step("index", () => personLink(this.model, intent.bookUrl, person, false));
              await step("delete", () => ensureDeleted(this.model, saved));
            }
          } else {
            await step("person", () => ensurePerson(this.model, saved));
            const current = await this.model.loadContact(saved.url);
            await step("index", () => personLink(this.model, intent.bookUrl, current, true));
            for (const label of intent.labels)
              await step(label, () => membership(this.model, intent.bookUrl, label, id, true));
            if (intent.kind === "migrate")
              await step("source", () => ensureDeleted(this.model, intent.source as SavedDocument));
          }
        }
        checkpoint("done");
      }
      if (intent.kind === "delete" && !intent.completed.includes("rolled-back"))
        this.deleted({ person: intent.person as SavedDocument, labels: intent.labels });
      journal.remove(intent);
    } catch (error) {
      if (error instanceof PartialWriteError) {
        // Include confirmed transport steps even when the enclosing stage did not finish.
        intent.completed = [...new Set([...intent.completed, ...error.completed])];
      }
      if (intent.kind === "delete" && intent.phase === "forward") intent.phase = "reconcile";
      journal.put(intent);
      throw error;
    }
  }
}
