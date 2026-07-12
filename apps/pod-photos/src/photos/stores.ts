// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The typed Pod Photos stores — wire the `schema:Photograph` and
 * `schema:ImageGallery` parse/build pairs into the generic {@link PodStore}.
 * These are the entry points an app/UI uses for read + write + list of photos
 * and albums, with Type-Index registration handled automatically.
 */
import { type Album, buildAlbum, parseAlbum } from './album.js';
import { type Photo, buildPhoto, parsePhoto } from './photograph.js';
import { type PodStore, type StoreConfig, createStore } from './store.js';
import {
  ALBUMS_SLUG,
  IMAGE_GALLERY_CLASS,
  PHOTOGRAPH_CLASS,
  PHOTOS_SLUG,
  PREFIXES,
} from './vocab.js';

/** Store config for `schema:Photograph` items under `photos/`. */
export const PHOTOS_CONFIG: StoreConfig<Photo> = {
  containerSlug: PHOTOS_SLUG,
  forClass: PHOTOGRAPH_CLASS,
  prefixes: PREFIXES,
  parse: parsePhoto,
  build: buildPhoto,
};

/** Store config for `schema:ImageGallery` items under `albums/`. */
export const ALBUMS_CONFIG: StoreConfig<Album> = {
  containerSlug: ALBUMS_SLUG,
  forClass: IMAGE_GALLERY_CLASS,
  prefixes: PREFIXES,
  parse: parseAlbum,
  build: buildAlbum,
};

/** Build a Photos store bound to the active pod + WebID. */
export function photosStore(opts: {
  podRoot: string;
  webId: string;
  fetchImpl?: typeof fetch;
}): PodStore<Photo> {
  return createStore(PHOTOS_CONFIG, opts);
}

/** Build an Albums store bound to the active pod + WebID. */
export function albumsStore(opts: {
  podRoot: string;
  webId: string;
  fetchImpl?: typeof fetch;
}): PodStore<Album> {
  return createStore(ALBUMS_CONFIG, opts);
}
