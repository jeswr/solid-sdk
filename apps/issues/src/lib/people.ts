"use client";

import { useEffect, useState } from "react";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { WebIdDataset } from "@solid/object";
import { DataFactory } from "n3";

/** A person rendered as a contact card: display name + avatar, not a raw WebID. */
export interface Person {
  webId: string;
  /** Display name from the profile (foaf:name chain), else the WebID host. */
  name: string;
  avatarUrl?: string;
}

export const shortWebId = (webId: string): string => {
  try {
    return new URL(webId).host;
  } catch {
    return webId;
  }
};

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

// Module-level cache: one profile fetch per WebID per page load, shared across
// components; in-flight requests are deduplicated.
const cache = new Map<string, Promise<Person>>();

/** Fetch (cached) a WebID's display profile. Never rejects — falls back to the host. */
export function getPerson(webId: string, fetchImpl?: typeof fetch): Promise<Person> {
  const cached = cache.get(webId);
  if (cached) return cached;
  const pending = (async (): Promise<Person> => {
    try {
      const { dataset } = await fetchRdf(webId, fetchImpl ? { fetch: fetchImpl } : undefined);
      const agent = new WebIdDataset(dataset, DataFactory).mainSubject;
      return { webId, name: agent?.name ?? shortWebId(webId), avatarUrl: agent?.photoUrl ?? undefined };
    } catch {
      return { webId, name: shortWebId(webId) };
    }
  })();
  cache.set(webId, pending);
  return pending;
}

/** Resolve a person's profile for rendering; placeholder (host name) until loaded. */
export function usePerson(webId?: string): Person | undefined {
  const [person, setPerson] = useState<Person | undefined>(
    webId ? { webId, name: shortWebId(webId) } : undefined,
  );
  useEffect(() => {
    if (!webId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPerson(undefined);
      return;
    }
    let cancelled = false;
    void getPerson(webId).then((p) => {
      if (!cancelled) setPerson(p);
    });
    return () => {
      cancelled = true;
    };
  }, [webId]);
  return person;
}

/** Resolve several people at once (e.g. team members). */
export function usePeople(webIds: string[]): Person[] {
  const key = webIds.join("\n");
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(webIds.map((w) => getPerson(w))).then((ps) => {
      if (!cancelled) setPeople(ps);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return people;
}
