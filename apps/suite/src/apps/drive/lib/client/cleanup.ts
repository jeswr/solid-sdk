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

/** Ownership proves which content may be discarded, never permission to adopt a replacement. */
export async function discardVersion<T>(options: {
  url: string;
  captured: DiscardSnapshot<T>;
  read: () => Promise<DiscardSnapshot<T> | undefined>;
  owns: (content: T) => boolean;
  remove: (etag: string) => Promise<void>;
}): Promise<void> {
  const current = options.captured;
  if (!options.owns(current.content)) throw new DriveError("conflict", 409, options.url);
  if (!current.etag || current.etag.startsWith("W/"))
    throw new DriveError("missing-validator", 409, options.url);
  try {
    await options.remove(current.etag);
  } catch (error) {
    if (!(error instanceof DriveError && error.status === 412)) throw error;
    // A missing copy is already cleaned up. A replacement, even byte-identical,
    // needs a new decision; the original validator stays pinned through refusal.
    if (await options.read()) throw error;
  }
}

/** Containment must be empty and every application statement must be one we own. */
export function ownsEmptyContainer(url: string, expected: Store, current: Store): boolean {
  return (
    new Container(url, current, DataFactory).contains.size === 0 &&
    sameGraph(expected, containerData(current, url))
  );
}
