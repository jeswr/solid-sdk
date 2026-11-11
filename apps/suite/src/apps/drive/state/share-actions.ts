// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { ShareBatch, ShareTextItem, ShareUrlItem } from "@jeswr/suite-native";
import type { PodSession } from "@/lib/session/pod-session";
import {
  createManualItem,
  manualUrl,
  registerManualType,
} from "../../home/components/item/manual-data";
import { BOOKMARK_FIELDS } from "../../home/lib/forms/edit-map";
import { DOMAINS } from "../../home/lib/model/domains";
import { readResource, subjectOf } from "../../home/lib/model/rdf";
import { loadTemplate } from "../../home/lib/templates";
import { createNotesStore } from "../../notes/lib/model/store";
import { captureTitle, escapeHtml } from "../../notes/lib/ui/capture";

/** Existing Home bookmarks and Notes writes, invoked only by the intake screen's buttons. */
export function createShareActions(session: PodSession) {
  const notes = createNotesStore({
    fetch: session.fetch,
    podRoot: session.storageUrl,
    webId: session.webId,
  });
  return {
    async saveLink(item: ShareUrlItem, batch: ShareBatch, index: number) {
      const type = DOMAINS.flatMap((domain) => domain.dataTypes).find(
        (type) => type.id === "bookmarks",
      );
      if (!type?.manualForm || !type.container) throw new Error("Bookmarks are unavailable");
      const title = item.title?.trim() || item.url;
      const url = manualUrl(session.storageUrl, type, title, `${batch.id}-${index}`);
      // Reuse this batch's deterministic URL after interruption, including a process restart.
      const existing = await readResource(session.fetch, url).catch((error: unknown) => {
        if (error instanceof RdfFetchError && error.status === 404) return undefined;
        throw error;
      });
      if (existing) {
        const subject = subjectOf(existing.dataset, `${url}#it`);
        if (
          !subject.types.includes(type.manualForm) ||
          !subject.texts("http://purl.org/dc/terms/title").includes(title) ||
          !subject.iris("http://www.w3.org/2002/01/bookmark#recalls").includes(item.url)
        )
          throw new Error("A different bookmark already uses this location");
        await registerManualType(
          session,
          type.manualForm,
          new URL(type.container, session.storageUrl).href,
        );
        return;
      }
      await createManualItem(
        session,
        type,
        url,
        await loadTemplate(type.manualForm, url),
        BOOKMARK_FIELDS,
        Object.fromEntries(
          BOOKMARK_FIELDS.map((field) => [field.id, field.kind === "url" ? item.url : title]),
        ),
      );
    },
    async saveText(item: ShareTextItem) {
      // Notes stores HTML; escape every shared character before using its existing writer.
      await notes.create({
        title: captureTitle(item.text.split(/\r?\n/)[0]?.trim() || "Shared text"),
        body: item.text
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join(""),
      });
    },
  };
}
