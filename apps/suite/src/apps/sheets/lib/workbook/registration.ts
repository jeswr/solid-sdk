// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { DataFactory } from "n3";
import {
  discoverRegistrations,
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
} from "../../../docs/lib/model/type-index";
import type { WorkbookServiceOptions } from "../contract";
import { SPREADSHEET_CLASS } from "../model";

/** Single shared registration per service, including concurrent creates. */
export function registration(options: WorkbookServiceOptions, root: string) {
  let pending: Promise<void> | undefined;
  async function register(): Promise<void> {
    const fetch = createPodScopedFetch(options.podRoot, { fetch: refuseRedirects(options.fetch) });
    const { dataset: profile } = await fetchRdf(options.webId, { fetch });
    const locations = await discoverRegistrations(options.webId, profile, fetch, options.podRoot);
    if (locations.some((r) => r.forClass === SPREADSHEET_CLASS && r.container === root)) return;
    // The shared writer bootstraps indexes. Sheets deliberately skips profiles
    // without any advertised index, including links in preferences/extended profiles.
    const documents = new Set<string>();
    const queue = [profile];
    let advertised = false;
    for (const dataset of queue) {
      const anchor = new ProfileTypeIndexAnchor(options.webId, dataset, DataFactory);
      if (anchor.publicIndexes.size || anchor.privateIndexes.size) {
        advertised = true;
        break;
      }
      for (const link of [...anchor.preferencesFiles, ...anchor.extendedProfiles]) {
        const url = new URL(link);
        url.hash = "";
        if (documents.has(url.href)) continue;
        if (documents.size >= 32) throw new Error("Too many Type Index profile documents");
        documents.add(url.href);
        queue.push((await fetchRdf(url.href, { fetch })).dataset);
      }
    }
    if (!advertised) return;
    await ensureTypeRegistrations({
      webId: options.webId,
      podRoot: options.podRoot,
      fetchImpl: fetch,
      registrations: [{ forClass: SPREADSHEET_CLASS, container: root }],
    });
  }
  return () => {
    pending ??= register().catch(() => {
      // Discovery and registration are best effort; a later create may retry.
      pending = undefined;
    });
    return pending;
  };
}
