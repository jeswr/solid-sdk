// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { encodeRef } from "@/lib/refs";
import { wacOnlyFetch } from "../../../shell/share/verified-wac-adapter";
import { documentSubject } from "../../docs/lib/model/document";
import { readRdf, writeRdf } from "../../docs/lib/model/rdf-io";
import { verifyPrivateIndexAccess } from "../../docs/lib/model/type-index-access";
import type { SharingSession } from "../../drive/lib/sharing/adapter";
import { ensurePrivateTasksAccess } from "../../tasks/state/access";
import { type Note, NoteDoc } from "./model/note";

type OwnerFields = Pick<Note, "labels" | "reminder" | "reminderId">;
export const preferencesUrl = (note: string, root: string) =>
  new URL(`settings/notes/${encodeRef(note)}.ttl`, root).href;

/** Access is verified before writing any private metadata. Never widen a preference ACL. */
export function privateNotePreferences(session: SharingSession & { mode: string }) {
  const fetch = wacOnlyFetch(session.fetch);
  const urlFor = (note: string) => preferencesUrl(note, session.storageUrl);
  async function read(note: string) {
    const url = urlFor(note);
    try {
      const { dataset, etag } = await readRdf(url, session.fetch);
      const doc = new NoteDoc(documentSubject(url), dataset, DataFactory);
      return {
        etag,
        fields: {
          labels: [...doc.labels],
          reminder: doc.reminder?.toISOString(),
          reminderId: doc.reminderId,
        },
      };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return undefined;
      throw error;
    }
  }
  return {
    urlFor,
    read,
    async write(note: string, fields: OwnerFields) {
      const url = urlFor(note);
      if (!(await ensurePrivateTasksAccess({ ...session, fetch }, url, session.webId)))
        await verifyPrivateIndexAccess(url, session.webId, session.storageUrl, fetch);
      const existing = await read(note);
      const dataset = new Store();
      const doc = new NoteDoc(documentSubject(url), dataset, DataFactory);
      for (const label of fields.labels) doc.labels.add(label);
      doc.reminder = fields.reminder === undefined ? undefined : new Date(fields.reminder);
      if (fields.reminderId !== undefined) doc.reminderId = fields.reminderId;
      await writeRdf(url, dataset, {
        fetchImpl: session.fetch,
        ...(existing ? { etag: existing.etag } : { createOnly: true }),
      });
      return { labels: [...fields.labels], reminder: fields.reminder, reminderId: doc.reminderId };
    },
  };
}
