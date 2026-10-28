// AUTHORED-BY Codex

import { Container } from "@solid/object";
import type { Store } from "n3";
import { DataFactory } from "n3";
import { DriveError } from "./client";
import { containerData, sameGraph } from "./rdf";

export interface DiscardSnapshot<T> {
  readonly content: T;
  readonly etag: string | undefined;
}

/** A newer validator is usable only after its content passes the same ownership proof. */
export async function discardVersion<T>(options: {
  url: string;
  captured: DiscardSnapshot<T>;
  read: () => Promise<DiscardSnapshot<T> | undefined>;
  owns: (content: T) => boolean;
  remove: (etag: string) => Promise<void>;
}): Promise<void> {
  let current = options.captured;
  for (let attempt = 0; ; attempt += 1) {
    if (!options.owns(current.content)) throw new DriveError("conflict", 409, options.url);
    if (!current.etag || current.etag.startsWith("W/"))
      throw new DriveError("missing-validator", 409, options.url);
    try {
      await options.remove(current.etag);
      return;
    } catch (error) {
      if (!(error instanceof DriveError && error.status === 412) || attempt === 2) throw error;
      const fresh = await options.read();
      if (!fresh) return;
      current = fresh;
    }
  }
}

/** Containment must be empty and every application statement must be one we own. */
export function ownsEmptyContainer(url: string, expected: Store, current: Store): boolean {
  return (
    new Container(url, current, DataFactory).contains.size === 0 &&
    sameGraph(expected, containerData(current, url))
  );
}
