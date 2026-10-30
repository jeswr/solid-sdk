// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { FEDERATION } from "../core/federation-vocab.js";
import { createFileVocabMap, SectorThing } from "../core/file-vocab-map.js";
import type { VocabMap } from "../core/types.js";
import { CLASSES, PodThing, safeIri } from "../core/vocab.js";

/** Sector classes and required properties supplement the legacy source fields. */
const mapTypes = createFileVocabMap({
  [CLASSES.VideoGame]: FEDERATION.CreativeWork,
  [CLASSES.OnlineAccount]: FEDERATION.MediaAccount,
});

export const vocabMap: VocabMap = (doc, context) => {
  const mapped = mapTypes(doc, context);
  const subjects = new Set([...mapped.dataset].map((quad) => quad.subject.value));
  for (const subject of subjects) {
    const account = new SectorThing(subject, mapped.dataset, DataFactory);
    if (!account.types.has(FEDERATION.MediaAccount)) continue;
    const webId = context?.webId;
    if (!webId || !safeIri(webId) || !URL.canParse(webId))
      throw new Error("Steam account imports require the importing user's WebID on PodWriter.");
    account.accountHolder = webId;
    const holder = new PodThing(webId, mapped.dataset, DataFactory);
    holder.types.add(FEDERATION.Agent);
    holder.types.add(FEDERATION.AccountHolder);
    account.accountProvider = "https://store.steampowered.com/";
    new PodThing(account.accountProvider, mapped.dataset, DataFactory).types.add(
      FEDERATION.AccountProvider,
    );
  }
  return mapped;
};
