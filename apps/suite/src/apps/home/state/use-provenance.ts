// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useEffect, useState } from "react";
import type { DomainItem } from "../lib/model/discovery";
import {
  createIdentityResolver,
  identitiesIn,
  type Provenance,
  type ProvenanceContext,
  provenanceOf,
} from "../lib/model/provenance";
import type { HomeSession } from "./use-domain-items";

// Cards and detail reads in this Home session share agent lookups, never the pod transport.
const resolvers = new WeakMap<HomeSession, ReturnType<typeof createIdentityResolver>>();

export function useProvenance(item: DomainItem, session: HomeSession): Provenance;
export function useProvenance(
  item: DomainItem | undefined,
  session: HomeSession,
): Provenance | undefined;
export function useProvenance(item: DomainItem | undefined, session: HomeSession) {
  const [resolved, setResolved] = useState<{
    item: DomainItem;
    session: HomeSession;
    identities: NonNullable<ProvenanceContext["identities"]>;
  }>();
  useEffect(() => {
    if (!item) return;
    let live = true;
    let resolve = resolvers.get(session);
    if (!resolve) {
      // The Permissions screen also uses the default public fetch and resolver options.
      resolve = createIdentityResolver();
      resolvers.set(session, resolve);
    }
    void resolve(item.dataset, item.subject, session.webId).then((identities) => {
      if (live) setResolved({ item, session, identities });
    });
    return () => {
      live = false;
    };
  }, [item, session]);
  if (!item) return undefined;
  return provenanceOf(item.dataset, item.subject, item.containerUrl, {
    storage: session.storageUrl,
    userWebId: session.webId,
    documentUrl: item.url,
    identities:
      resolved?.item === item && resolved.session === session
        ? resolved.identities
        : identitiesIn(item.dataset, item.subject),
  });
}
