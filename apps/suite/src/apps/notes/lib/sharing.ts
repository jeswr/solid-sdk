// AUTHORED-BY Codex GPT-6.1-Sol

import { shareRoleRank } from "../../../shell/lib/share-options";
import {
  ShareError,
  type ShareRole,
  type ShareWriteOptions,
  type SharingAdapter,
  type SharingState,
} from "../../../shell/share/types";
import { VerifiedWacSharingAdapter, wacOnlyFetch } from "../../../shell/share/verified-wac-adapter";
import { WacSharingAdapter } from "../../../shell/share/wac-adapter";
import { isDirectChild } from "../../docs/lib/model/layout";
import type { SharingSession } from "../../drive/lib/sharing/adapter";
import { noteImages, notesMediaContainer } from "./images";

/** Grants require every image policy; revocations narrow each manageable resource independently. */
export class NoteSharingAdapter implements SharingAdapter {
  readonly supportsCommenter = false;
  readonly supportsGeneralCommenter = false;
  private loaded = false;
  private readonly failedImages = new Map<string, Set<string>>();
  readonly images: readonly string[];
  private readonly containers: string[];
  constructor(
    private readonly note: { url: string; body: string },
    session: SharingSession & { mode: string },
    private readonly access: SharingAdapter = new VerifiedWacSharingAdapter(session),
  ) {
    const media = notesMediaContainer(session.storageUrl);
    this.images = Object.freeze([
      ...new Set(
        noteImages(note.body, session.storageUrl)
          .map(({ src }) => src)
          .filter((url) => isDirectChild(url, media)),
      ),
    ]);
    this.containers = ["notes/", "notes/archive/", "notes/.trash/"].map(
      (path) => new URL(path, session.storageUrl).href,
    );
  }
  private assertTarget(url: string) {
    if (
      url !== this.note.url ||
      !this.containers.some((container) => isDirectChild(url, container))
    )
      throw new ShareError("unsupported");
  }
  private async loadNote(url: string, signal: AbortSignal) {
    this.loaded = false;
    this.assertTarget(url);
    const state = await this.access.load(url, signal);
    if (!state.canManage || state.readOnly) throw new ShareError("forbidden");
    this.loaded = true;
    return state;
  }
  private async imagePolicy(image: string, signal: AbortSignal) {
    const state = await this.access.load(image, signal);
    if (!state.canManage || state.readOnly) throw new ShareError("forbidden");
    return state;
  }
  private async imagePolicies(signal: AbortSignal) {
    const policies = new Map<string, SharingState>();
    try {
      for (const image of this.images) policies.set(image, await this.imagePolicy(image, signal));
    } catch {
      signal.throwIfAborted();
      throw new ShareError("images-unavailable");
    }
    return policies;
  }
  async load(url: string, signal: AbortSignal): Promise<SharingState> {
    const state = await this.loadNote(url, signal);
    let grantDisabledReason: string | undefined;
    try {
      await this.imagePolicies(signal);
    } catch {
      signal.throwIfAborted();
      grantDisabledReason =
        "Image access couldn't be checked. You can still remove or reduce access.";
    }
    const failedImages = [
      ...new Set([...this.failedImages.values()].flatMap((images) => [...images])),
    ];
    return {
      ...state,
      ...(grantDisabledReason ? { grantDisabledReason } : {}),
      ...(failedImages.length
        ? {
            updateWarning: `Image access couldn't be confirmed: ${failedImages.join(", ")}`,
          }
        : {}),
    };
  }
  private writable(url: string) {
    this.assertTarget(url);
    if (!this.loaded) throw new ShareError("unsupported");
  }
  /** Explicit Share action for the immutable image list shown in this dialog. */
  async shareImages(signal: AbortSignal) {
    await this.grantImages(await this.loadNote(this.note.url, signal), signal);
  }
  private async grantImages(state: SharingState, signal: AbortSignal) {
    // Verify the entire list before granting access to any image or the note.
    for (const [image, current] of await this.imagePolicies(signal)) {
      for (const person of state.people)
        if (
          (person.role === "viewer" || person.role === "editor") &&
          !current.people.some((existing) => existing.webId === person.webId)
        )
          await this.access.setPerson(image, person.webId, "viewer");
      if (state.general.mode === "link" && current.general.mode === "restricted")
        await this.access.setGeneral(image, { mode: "link", role: "viewer" });
    }
  }
  private async revokeImages(
    key: string,
    revoked: (state: SharingState) => boolean,
    update: (image: string) => Promise<void>,
  ) {
    const failed = new Set(this.images);
    for (const image of this.images) {
      try {
        if (!revoked(await this.imagePolicy(image, new AbortController().signal))) {
          await update(image);
          if (!revoked(await this.imagePolicy(image, new AbortController().signal))) continue;
        }
        failed.delete(image);
      } catch {
        // Includes writes that committed but could not be read back. Keep them unconfirmed.
      }
    }
    if (failed.size) this.failedImages.set(key, failed);
    else this.failedImages.delete(key);
  }
  private async revokeAfterNoteWrite(
    key: string,
    write: () => Promise<void>,
    revoked: (state: SharingState) => boolean,
    update: (image: string) => Promise<void>,
  ) {
    const previous = this.failedImages.get(key);
    const restore = () => {
      if (previous) this.failedImages.set(key, previous);
      else this.failedImages.delete(key);
    };
    // The setter may commit its PUT and then reject during read-back. Account for
    // every image before that ambiguous operation starts, including failed reconciliation.
    this.failedImages.set(key, new Set(this.images));
    let failure: { error: unknown } | undefined;
    try {
      await write();
    } catch (error) {
      if (error instanceof ShareError && error.code === "would-grant") {
        // This typed refusal guarantees no PUT. Report the grant instead of using
        // the revocation path to bypass the image preflight.
        restore();
        throw error;
      }
      failure = { error };
    }
    let committed: SharingState;
    try {
      committed = await this.loadNote(this.note.url, new AbortController().signal);
    } catch (error) {
      throw failure ? failure.error : error;
    }
    if (!revoked(committed)) {
      // An unchanged read cannot settle an errored PUT: it may still commit later.
      // Keep the images pending until this key is successfully reconciled.
      throw failure ? failure.error : new ShareError("conflict");
    }
    await this.revokeImages(key, revoked, update);
  }
  async setPerson(
    url: string,
    webId: string,
    role: ShareRole | null,
    opts?: ShareWriteOptions & { expires?: Date; purpose?: string },
  ) {
    this.writable(url);
    if ((role !== null && role !== "viewer" && role !== "editor") || opts?.expires || opts?.purpose)
      throw new ShareError("unsupported");
    const signal = new AbortController().signal;
    const state = await this.loadNote(url, signal);
    const person = state.people.find((person) => person.webId === webId);
    if (person?.role === "owner" || person?.inherited) throw new ShareError("forbidden");
    if (role && (!person || shareRoleRank[role] > shareRoleRank[person.role])) {
      if (opts?.narrowOnly) throw new ShareError("would-grant");
      await this.grantImages(
        {
          ...state,
          people: [...state.people.filter((person) => person.webId !== webId), { webId, role }],
        },
        signal,
      );
      await this.access.setPerson(url, webId, role);
    } else {
      await this.revokeAfterNoteWrite(
        `person:${webId}`,
        () => this.access.setPerson(url, webId, role, { narrowOnly: true }),
        (current) => {
          const existing = current.people.find((person) => person.webId === webId);
          return (
            !existing || (role !== null && shareRoleRank[existing.role] <= shareRoleRank[role])
          );
        },
        (image) => this.access.setPerson(image, webId, role, { narrowOnly: true }),
      );
    }
  }
  async setGeneral(url: string, general: SharingState["general"], opts?: ShareWriteOptions) {
    this.writable(url);
    if (
      !["restricted", "link"].includes(general.mode) ||
      (general.role !== undefined && !["viewer", "editor"].includes(general.role))
    )
      throw new ShareError("unsupported");
    const signal = new AbortController().signal;
    const state = await this.loadNote(url, signal);
    if (
      general.mode === "link" &&
      (state.general.mode !== "link" ||
        shareRoleRank[general.role ?? "viewer"] > shareRoleRank[state.general.role ?? "viewer"])
    ) {
      if (opts?.narrowOnly) throw new ShareError("would-grant");
      await this.grantImages({ ...state, general }, signal);
      await this.access.setGeneral(url, general);
    } else {
      await this.revokeAfterNoteWrite(
        "general",
        () => this.access.setGeneral(url, general, { narrowOnly: true }),
        (current) =>
          current.general.mode === "restricted" ||
          (general.mode === "link" &&
            current.general.mode === "link" &&
            shareRoleRank[current.general.role ?? "viewer"] <=
              shareRoleRank[general.role ?? "viewer"]),
        (image) => this.access.setGeneral(image, general, { narrowOnly: true }),
      );
    }
  }
}

/** Read-only discovery: no ACL creation, four concurrent reads, unknown stays unmarked. */
export async function discoverNoteShares(
  urls: readonly string[],
  session: SharingSession,
  signal: AbortSignal,
  found: (url: string, shared: boolean) => void,
  adapter: SharingAdapter = new WacSharingAdapter({
    ...session,
    fetch: wacOnlyFetch(session.fetch),
  }),
) {
  for (let offset = 0; offset < urls.length && !signal.aborted; offset += 4) {
    await Promise.all(
      urls.slice(offset, offset + 4).map(async (url) => {
        try {
          const state = await adapter.load(url, signal);
          if (!signal.aborted)
            found(
              url,
              state.general.mode !== "restricted" ||
                state.people.some((person) => person.webId !== session.webId),
            );
        } catch {
          // Missing, inherited, unreadable or unsupported ACLs are unknown.
        }
      }),
    );
  }
}
