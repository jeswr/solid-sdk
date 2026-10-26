<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Lyrics (MUS-L5, sst-iidc)

Pure TypeScript; no I/O, React or added dependencies. Import from `./index`:

```ts
const lyrics = parseLrc("[offset:250]\n[00:01.25]A paper moon");
currentLineAt(lyrics, 1000)?.text; // "A paper moon"
serialiseLrc(lyrics); // "[offset:250]\n[00:01.250]A paper moon"
```

All API times are milliseconds. Source timestamps remain unadjusted in the model;
positive offset advances display (`effectiveTime = timeMs - offsetMs`). Lookup uses
binary search over stable sorted lines, returns null before the first line, the
last occurrence at tied times, and the final line after its start. Empty timed
lines clear the displayed lyrics. Negative/nonfinite playback positions fail.

`parseLrc` accepts `[mm:ss]` or `[mm:ss.f]` with 2–4 minute digits, seconds 00–59,
and 1–3 fractional digits. Repeated leading timestamps expand to separate lines.
`<mm:ss.f>` markers carry absolute word/segment starts; whitespace is preserved,
untimed prefix text starts at the line timestamp, equal starts are permitted, and
an empty final segment preserves a word end marker. Word starts must be ordered
and at or after the line start. Repeated line timestamps shift words by the delta
from the first timestamp. The inline marker structure follows the
[Enhanced LRC editor documentation](https://www.quicklrc.com/subtitle-formats/enhanced-lrc).

Metadata is an ordered array of `{key,value}`; duplicate and unknown keys are
preserved without executing their contents. Keys begin with an ASCII letter,
then letters/digits/underscore/hyphen; values cannot contain brackets. A single
case-insensitive `offset` tag is parsed separately as a signed integer. Offset
zero is omitted on output unless it is the document’s only content. Metadata can occur anywhere on its own physical line.
Canonical output moves metadata to the top and emits sorted cues, one timestamp
per line, with exactly three fractional digits and LF separators (no final LF).

Documents, metadata, lines and words are deeply frozen. `serialiseLrc` and
`currentLineAt` require the original parsed document; copied/forged objects are
rejected. To edit, change source text and parse again. Serialisation preserves
semantic content and timing, rather than the original layout of tags/repetitions.

Plain text without LRC-shaped syntax falls back to `kind: "plain"`, preserving
whitespace and line breaks after BOM removal and CRLF/CR → LF normalisation.
Its `lines` are empty, lookup returns null, and serialisation returns its text.
Metadata-only input is an LRC document with no timed lines. Mixed timed/untimed
content, malformed tags/times/word markers, duplicate offsets, invalid Unicode,
controls other than tabs/newlines and unsupported line separators fail closed.
Numeric square/angle tags and metadata-shaped tags are reserved, including when
embedded in prose; they never cause a silent plain-text fallback. In enhanced
lines square brackets and stray angle delimiters are rejected as ambiguous.

`LYRICS_LIMITS` caps raw input **and expanded canonical output** at 1,000,000 UTF-16
code units, 10,000 physical lines and 16,384 code units per line. Timestamps and
offset magnitude are at most 24 hours. Expansion is checked incrementally before
accumulating an oversized document. All rejection paths throw `LyricsError` with
a stable `code` and fixed message that never includes supplied content.
