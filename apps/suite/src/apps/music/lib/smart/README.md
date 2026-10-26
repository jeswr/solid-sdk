<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Smart playlists (MUS-L4)

Pure functions over the Music `LibraryTrack` adapter model. No React, subscription,
clock, RDF, storage, or fetch dependency. Re-run `evaluateSmartPlaylist(library, playlist)`
with the current library whenever metadata changes. It validates the entire definition and
library before selecting anything and returns a fresh array of the original records.

```ts
import {
  evaluateSmartPlaylist, parseSmartPlaylist, serializeSmartPlaylist,
  type SmartPlaylist,
} from "./index";

const playlist: SmartPlaylist = {
  version: 1,
  mode: "all",
  rules: [
    { field: "genre", operator: "eq", value: "Folk" },
    { field: "rating", operator: "gte", value: 4.5 },
  ],
  sort: { field: "lastPlayedAt", direction: "asc" },
  limit: 25,
};
// library is readonly SmartPlaylistTrack[] supplied by the caller.
const selected = evaluateSmartPlaylist(library, playlist);
const restored = parseSmartPlaylist(serializeSmartPlaylist(playlist));
```

The runtime schema is `validateSmartPlaylist(unknown)`. It returns independent data records
and rejects unknown keys at every object level, unsupported versions, nested groups, invalid
operators, mismatched value types, explicit undefined options, accessors, non-enumerable keys,
symbol keys, custom object prototypes, sparse arrays and array overrides. Parsing invalid JSON raises
`SmartPlaylistError("invalid-json")`; a structurally invalid definition raises
`SmartPlaylistError("invalid-playlist")`. Serialization validates first and constructs plain
JSON data without invoking a caller's `toJSON`.

| Field | Projection / allowed values | Operators |
| --- | --- | --- |
| artist | LibraryTrack.artist | eq, ne, contains, startsWith, endsWith |
| album | LibraryTrack.albumTitle (not albumId) | eq, ne, contains, startsWith, endsWith |
| genre | Optional single genre string | eq, ne, contains, startsWith, endsWith |
| year | Optional integer 1–9999 | eq, ne, lt, lte, gt, gte |
| playCount | Optional nonnegative safe integer | eq, ne, lt, lte, gt, gte |
| lastPlayedAt | Optional integer epoch milliseconds, ±8,640,000,000,000,000 | eq, ne, lt, lte, gt, gte |
| rating | Optional finite number 0–5, fractional allowed | eq, ne, lt, lte, gt, gte |

`SmartPlaylistTrack` extends LibraryTrack within this module; no upstream model changes are
required. Callers supply play statistics explicitly; missing values are unknown and fail every
comparison, including `ne`. Explicit zero play count is distinct from unknown play count.
Text matches are case sensitive, with no normalization, trimming, locale collation, regex,
or artist/album ID resolution. Text must be nonempty, well-formed Unicode without control
characters or leading/trailing whitespace. Multiple artists/genres, timestamps as strings,
other rating scales and inferred play history must be adapted explicitly by the caller.

`mode: "all"` intersects the flat rules (empty rules match all tracks); `"any"` unions them
(empty rules match none). There is no implicit current time or relative-date operator.

Sort accepts one rule field or `title` and an explicit `asc`/`desc` direction. It compares
numbers numerically and strings by exact UTF-16 code units. Missing values come last in both
directions; equal or missing sort values break ties by ascending exact track ID. Without
sort, library order is preserved. Limit is a nonnegative safe integer applied after filtering
and sorting; zero yields an empty array and an absent limit is unbounded.

Invalid tracks, duplicate track IDs, invalid optional metadata and sparse library arrays raise
`SmartPlaylistError("invalid-library")`, including when a rule excludes them or limit is zero.
Base track validation follows Music library validation. Extra plain track properties survive
in the returned records. All error messages omit caller data. See root QUESTIONS.md for the
spec gaps and conservative assumptions used for this implementation.
