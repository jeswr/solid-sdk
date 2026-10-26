// AUTHORED-BY Codex GPT-6.1-Sol
import type { LibraryTrack, NameSortOptions } from "./types";
import { exactCompare, MusicLibraryError, record, text, validateTracks } from "./validation";

function configuration(options: NameSortOptions) {
  record(options, "invalid-options");
  const locale = options.locale === undefined ? "en" : options.locale;
  text(locale, "invalid-options");
  const articles = options.articles === undefined ? ["The", "A", "An"] : options.articles;
  if (!Array.isArray(articles)) throw new MusicLibraryError("invalid-options");
  for (const article of articles) {
    text(article, "invalid-options");
    if (/\s/u.test(article)) throw new MusicLibraryError("invalid-options");
  }
  try {
    if (Intl.Collator.supportedLocalesOf([locale]).length === 0) {
      throw new MusicLibraryError("invalid-options");
    }
    return {
      collator: new Intl.Collator(locale, { numeric: true, sensitivity: "base" }),
      articles: new Set(articles.map((article) => article.toLowerCase())),
    };
  } catch {
    throw new MusicLibraryError("invalid-options");
  }
}

function key(name: string, articles: ReadonlySet<string>): string {
  text(name, "invalid-name");
  const match = /^(\S+)\s+(.+)$/u.exec(name);
  if (match && articles.has((match[1] as string).toLowerCase())) return match[2] as string;
  return name;
}

/** Remove one leading article followed by whitespace; never alters display metadata. */
export function sortName(name: string, options: NameSortOptions = {}): string {
  return key(name, configuration(options).articles);
}

/** Numeric, base-sensitive collation, then display-name collation and exact spelling. */
export function createNameComparator(
  options: NameSortOptions = {},
): (a: string, b: string) => number {
  const { collator, articles } = configuration(options);
  return (a, b) =>
    collator.compare(key(a, articles), key(b, articles)) ||
    collator.compare(a, b) ||
    exactCompare(a, b);
}

/** Album-local ordering: absent disc = 1, absent track follows numbered tracks. */
export function trackComparator(compareName: (a: string, b: string) => number) {
  return (a: LibraryTrack, b: LibraryTrack): number =>
    (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
    (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity) ||
    compareName(a.title, b.title) ||
    exactCompare(a.id, b.id);
}

/** Returns a fresh array. Equal/missing positions use title and exact track ID ties. */
export function orderTracks(
  tracks: readonly LibraryTrack[],
  options: NameSortOptions = {},
): LibraryTrack[] {
  validateTracks(tracks);
  return [...tracks].sort(trackComparator(createNameComparator(options)));
}
