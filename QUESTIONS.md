<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-L3 interpretation questions

1. **Grouping identity and missing metadata** (07-parity-backlog §Music; 11-pure-libraries-3):
   should albums merge by title or by identifier, and should missing fields get invented labels?
   Conservative implementation: require track ID, title, artist name, album ID and album title;
   album IDs and artist names are exact identities. Same-title releases stay separate. Adapters
   resolve aliases and multiple artist credits before calling this library. Conflicting titles or
   explicit album artists for one album ID are rejected. One explicit album artist applies to the
   album; otherwise fall back to the unique track artist, or Various Artists for multiple artists.
   An explicit Various Artists credit also marks a compilation; guest credits alone do not override
   an explicit album artist. Artist groups use performing artists, not album artists.
2. **Ordering and durations** (MUS-L3 task; 11-pure-libraries-3): should absent positions/durations
   be guessed, and are durations seconds or milliseconds? Use optional positive integer disc/track
   positions (missing disc = 1; missing track sorts last), then title and ID ties. Durations are
   optional nonnegative safe integer seconds, matching pod-music. Any unknown duration makes the
   total unknown; display unknown as an em dash, otherwise m:ss or h:mm:ss. No rounding/coercion.
   Sort names strip one configurable leading article (default The/A/An), preserving display names;
   locale defaults to en, with numeric, base-sensitive Intl.Collator and exact spelling tie breaks.
3. **Play-log semantics** (07-parity-backlog §Music; MUS-L3 task): should replayed events count
   twice, should unknown tracks be ignored, and how should time windows work? Require unique event
   IDs, known track IDs and integer epoch-millisecond instants; reject duplicate events and dangling
   references, including outside the selected window. Every event counts once without a playback
   threshold. Aggregate per track; recent sorts by latest instant, most by count then latest instant,
   with track ID ties. Optional time bounds use [from, to), with no implicit clock or time zone.
   Unplayed tracks are omitted. Empty inputs return empty groups and zero duration.

These conservative choices allow the pure library to ship without making RDF, hook or UI decisions.
