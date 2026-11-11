// AUTHORED-BY Codex GPT-6.1-Sol

import {
  ShareError,
  type ShareRole,
  type SharingAdapter,
  type SharingState,
} from "../../../shell/share/types";
import { VerifiedWacSharingAdapter, wacOnlyFetch } from "../../../shell/share/verified-wac-adapter";
import { WacSharingAdapter } from "../../../shell/share/wac-adapter";
import { isDirectChild } from "../../docs/lib/model/layout";
import type { SharingSession } from "../../drive/lib/sharing/adapter";
import { noteImages, notesMediaContainer } from "./images";

/** Images can belong to several notes. Their existing access is never removed or downgraded. */
export class NoteSharingAdapter implements SharingAdapter {
  readonly supportsCommenter = false;
  readonly supportsGeneralCommenter = false;
  private loaded = false;
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
  async load(url: string, signal: AbortSignal) {
    this.loaded = false;
    this.assertTarget(url);
    const state = await this.access.load(url, signal);
    if (!state.canManage || state.readOnly) throw new ShareError("forbidden");
    // Preflight every image before allowing any collaborator changes.
    for (const image of this.images) {
      const access = await this.access.load(image, signal);
      if (!access.canManage || access.readOnly) throw new ShareError("forbidden");
    }
    this.loaded = true;
    return state;
  }
  private writable(url: string) {
    this.assertTarget(url);
    if (!this.loaded) throw new ShareError("unsupported");
  }
  /** Explicit Share action for the immutable image list shown in this dialog. */
  async shareImages(signal: AbortSignal) {
    await this.grantImages(await this.load(this.note.url, signal));
  }
  private async grantImages(state: SharingState) {
    for (const image of this.images) {
      const current = await this.access.load(image, new AbortController().signal);
      if (!current.canManage || current.readOnly) throw new ShareError("forbidden");
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
  async setPerson(
    url: string,
    webId: string,
    role: ShareRole | null,
    opts?: { expires?: Date; purpose?: string },
  ) {
    this.writable(url);
    if ((role !== null && role !== "viewer" && role !== "editor") || opts?.expires || opts?.purpose)
      throw new ShareError("unsupported");
    const state = await this.load(url, new AbortController().signal);
    await this.grantImages({
      ...state,
      people: [
        ...state.people.filter((person) => person.webId !== webId),
        ...(role ? [{ webId, role }] : []),
      ],
    });
    await this.access.setPerson(url, webId, role);
  }
  async setGeneral(url: string, general: SharingState["general"]) {
    this.writable(url);
    if (
      !["restricted", "link"].includes(general.mode) ||
      (general.role !== undefined && !["viewer", "editor"].includes(general.role))
    )
      throw new ShareError("unsupported");
    const state = await this.load(url, new AbortController().signal);
    await this.grantImages({ ...state, general });
    await this.access.setGeneral(url, general);
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
