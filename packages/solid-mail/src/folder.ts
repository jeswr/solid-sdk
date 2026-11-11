// AUTHORED-BY Codex (GPT-6.1 Sol)
import { entities } from "./generated/model.js";
import { publicWrapper } from "./wrapper.js";

export const WellKnownFolders = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  trash: "trash",
  archive: "archive",
} as const;
export type WellKnownFolder = (typeof WellKnownFolders)[keyof typeof WellKnownFolders];

/** Generated live fields with the original folder convenience methods. */
export class Folder extends publicWrapper(entities.Folder.Wrapper) {
  markFolder(): void {
    this.mark();
  }
  addMessage(messageIri: string): void {
    this.messageIris.add(messageIri);
  }
  removeMessage(messageIri: string): void {
    this.messageIris.delete(messageIri);
  }
  has(messageIri: string): boolean {
    return this.messageIris.has(messageIri);
  }
  get size(): number {
    return this.messageIris.size;
  }
}
