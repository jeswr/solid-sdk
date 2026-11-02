// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import {
  DataFactory,
  loadMusic,
  MusicNode,
  MusicWriteError,
  Playlist,
  Store,
  saveMusic,
} from "../model";
import { S } from "../model/vocab";
import { documentUrl, type Library, musicRoot, requireEtag } from "./library";

export interface MusicPlaylist {
  id: string;
  name: string;
  description: string;
  tracks: string[];
  etag: string | null;
}
export function listPlaylists(library: Library): MusicPlaylist[] {
  return library.models.playlists
    .filter((p) => !new URL(p.value).pathname.endsWith("/playlists/liked.ttl"))
    .map((p) => ({
      id: p.value,
      name: p.title,
      description: p.strings(`${S}description`)[0] ?? "",
      tracks: p.tracks,
      etag: library.documents.get(p.value.split("#")[0] as string)?.etag ?? null,
    }));
}
export async function createPlaylist(
  fetch: typeof globalThis.fetch,
  storage: string,
  id: string,
  name: string,
  description: string,
): Promise<MusicPlaylist> {
  const url = new URL(`playlists/${encodeURIComponent(id)}.ttl`, musicRoot(storage)).href;
  const dataset = new Store();
  const p = new Playlist(`${url}#it`, dataset).stampType();
  p.title = name.trim();
  p.writeString(`${S}description`, description.trim());
  const etag = await saveMusic(fetch, storage, url, dataset, { ifNoneMatch: "*" });
  return { id: p.value, name: p.title, description: description.trim(), tracks: [], etag };
}
export type PlaylistEdit =
  | { kind: "rename"; name?: string; description?: string }
  | { kind: "add"; tracks: string[] }
  | { kind: "remove"; position: number }
  | { kind: "move"; from: number; to: number };
export async function editPlaylist(
  fetch: typeof globalThis.fetch,
  storage: string,
  current: MusicPlaylist,
  edit: PlaylistEdit,
): Promise<MusicPlaylist> {
  const url = documentUrl(storage, current.id);
  const doc = await loadMusic(createPodScopedFetch(storage, { fetch }), url);
  const p = new Playlist(current.id, doc.dataset);
  if (edit.kind === "rename") {
    if (edit.name !== undefined) p.title = edit.name.trim();
    if (edit.description !== undefined) p.writeString(`${S}description`, edit.description.trim());
  } else if (edit.kind === "add") p.setTracks([...p.tracks, ...edit.tracks]);
  else if (edit.kind === "remove") p.removeAt(edit.position);
  else p.reorder(edit.from, edit.to);
  const etag = await saveMusic(fetch, storage, url, doc.dataset, {
    ifMatch: requireEtag(current.etag),
  });
  return {
    id: current.id,
    name: p.title,
    description: p.strings(`${S}description`)[0] ?? "",
    tracks: p.tracks,
    etag,
  };
}
export async function deletePlaylist(
  fetch: typeof globalThis.fetch,
  storage: string,
  current: MusicPlaylist,
): Promise<void> {
  const url = documentUrl(storage, current.id);
  const scoped = createPodScopedFetch(storage, { fetch, maxRedirects: 0 });
  const doc = await loadMusic(scoped, url);
  const entries = new Playlist(current.id, doc.dataset).objects(`${S}itemListElement`);
  doc.dataset.removeQuads(
    doc.dataset.getQuads(DataFactory.namedNode(current.id), null, null, null),
  );
  for (const entry of entries) {
    if (entry.termType !== "NamedNode" && entry.termType !== "BlankNode") continue;
    const term =
      entry.termType === "NamedNode"
        ? DataFactory.namedNode(entry.value)
        : DataFactory.blankNode(entry.value);
    if (
      new MusicNode(term, doc.dataset).types.has(`${S}ListItem`) &&
      doc.dataset.getQuads(null, null, term, null).length === 0
    )
      doc.dataset.removeQuads(doc.dataset.getQuads(term, null, null, null));
  }
  if (doc.dataset.size) {
    await saveMusic(fetch, storage, url, doc.dataset, { ifMatch: requireEtag(current.etag) });
    return;
  }
  const response = await scoped(url, {
    method: "DELETE",
    headers: { "If-Match": requireEtag(current.etag) },
  });
  if (!response.ok) throw new MusicWriteError(response.status, response.headers.get("etag"));
}
