<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Play queue and playlist text

Pure TypeScript. Import from `./index`. No React, fetch, RDF, clocks, audio elements,
random globals, filesystem or persistence. No new dependencies.

```ts
import { createPlayQueue, reducePlayQueue, parseM3u8, serialisePls } from "./index";

const imported = parseM3u8(
  "#EXTM3U\n#EXTINF:125,Mira Vale — Fictional dawn\n../audio/dawn.mp3\n",
  "https://example.org/music/lists/favourites.m3u8",
);
let queue = createPlayQueue(imported.map((track, i) => ({ ...track, id: `entry-${i}` })));
queue = reducePlayQueue(queue, { type: "repeat", mode: "all" });
queue = reducePlayQueue(queue, { type: "shuffle", enabled: true, seed: 42 });
const pls = serialisePls(imported);
```

## Queue contract

- Entries are generic payloads with unique nonblank occurrence IDs. Repeated tracks
  use distinct occurrence IDs. Arrays are copied; payload objects are retained and
  should be treated as immutable. Invalid state/actions throw `MusicQueueError`.
- `createPlayQueue(entries)` selects the first entry, or null for empty. Null also
  represents stopped playback. Adding entries preserves null; manual skip starts
  from the first entry, previous from the last. Completion while stopped is a no-op.
- `play-next` inserts a supplied block after current, preserving block order (at the
  front when stopped). `add-to-end` appends. Neither changes the current entry.
  `remove` selects current's successor, or predecessor at the end, or null when empty.
  `move` uses the final zero-based index and preserves current's identity.
- **The playback adapter must seek to zero on every `skip`, `previous` or `ended`
  action**, including when current's ID stays the same. A null ID stops playback.
  `previous` takes explicit finite nonnegative `elapsedSeconds`; at >= 3 seconds it
  restarts current, below 3 it selects the preceding entry. At the first entry it
  restarts unless repeat-all wraps. No clock or elapsed position is stored here.
- Repeat `off` stops past the end. `all` wraps. `one` repeats on natural `ended`,
  while manual skip/previous still navigate. All empty-queue navigation stays empty.
- Shuffle requires an unsigned 32-bit seed (including zero). It uses descending
  Fisher-Yates with a uint32 LCG (`s = 1664525*s + 1013904223 mod 2^32`) on every
  entry except current, which stays at its displayed index. There is no random
  call when fewer than two candidates remain. This generator is for reproducible
  playback order, with no cryptographic purpose.
- Enabling an already enabled shuffle is idempotent (no reshuffle). Disabling restores
  saved IDs in order and keeps current's identity, including after navigation.
  Additions/removals update both displayed and saved order; play-next is inserted
  after current in each order. Moves during shuffle affect only displayed order
  and are undone on disable. A seed is required and validated even for disable.

## Playlist contract

`PlaylistEntry` contains an absolute HTTP(S) `url`, a `title` (empty means absent),
and `durationSeconds` (safe nonnegative integer, or null for unknown).
Duplicates remain separate entries. URL references resolve against a required
absolute HTTP(S) base IRI using URL resolution, including `../`, root-relative,
network-path, queries and Unicode IRIs. Serializers emit absolute encoded URLs.

M3U/M3U8 APIs consume **already-decoded Unicode strings**. The caller must decode
M3U8 as strict UTF-8 and explicitly decode any legacy M3U encoding; this library
never guesses an encoding. Both use identical grammar. BOM, LF/CRLF/CR, empty lines
and ordinary `#` comments are accepted. Extended metadata requires a first-content
`#EXTM3U` header, then `#EXTINF:seconds,title` before each entry. Unknown duration
is `-1`; title can contain commas. Metadata cannot repeat or dangle. Plain M3U
entries have empty titles and unknown durations. Serializers always emit extended
M3U with a header and one EXTINF per entry.

PLS accepts exactly `[playlist]`, `FileN`, optional `TitleN` / `LengthN`, required
`NumberOfEntries` and `Version=2`, with case-sensitive keys. Fields may be reordered;
entry numbering must be contiguous from 1 with matching count and a file for every
entry. Missing titles become empty; missing lengths or -1 become null. Blank lines
and a leading BOM are accepted. Output emits all fields in order.

Both serializers use LF and a trailing newline. Titles preserve whitespace and
Unicode without extracting an artist or guessing metadata. Reject unsupported
extensions (including HLS `#EXT-X-*`), PLS keys/sections/comments/versions, fractional
or malformed durations, controls (including tabs), unpaired surrogates, malformed
URL escapes, local/Windows paths, URL credentials and non-HTTP(S) schemes. Root-relative
web paths are supported. Error codes distinguish invalid queue, action, entry, URL,
playlist syntax and unsupported playlist features; messages never echo input data.

The format subset follows the [Winamp M3U/PLS description](https://forums.winamp.com/forum/tech-support-greatest-hits/43345-m3u-and-pls-specification);
[HLS](https://www.rfc-editor.org/rfc/rfc8216.html) is deliberately rejected rather than
interpreting segment playlists as track lists. See root `QUESTIONS.md` for boundary
choices. Vitest enforces 100% statements, branches, functions and lines per source file.
