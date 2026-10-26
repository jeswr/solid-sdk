<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# PHO-L3 conservative interpretations

1. Cover fallback is unspecified (07-parity-backlog, Photos / Albums; 11-pure-libraries-3,
   PHO-L3). Options: first ordered member, newest member, or no automatic cover. Use the
   first ordered member; an empty album returns null. An explicit non-member cover is a
   typed error, so callers must clear a removed cover explicitly.
2. Smart predicate composition and boundaries are unspecified (11-pure-libraries-3,
   PHO-L3). Options: AND/OR, inclusive/exclusive dates, exact/normalised camera matching.
   Use AND (empty predicates match all), inclusive epoch-millisecond instants, and exact
   make/model matching. Missing metadata does not match the corresponding predicate,
   except has-GPS=false. Parsing EXIF civil dates and choosing a timezone are caller tasks.
3. Shift-selection semantics are unspecified beyond crossing groups (07-parity-backlog,
   Photos / Screens; 01-design-system §6). Options: replace/add ranges and reset/retain
   anchor. Replace with the inclusive displayed range and retain its anchor; without an
   anchor select the target alone. Toggle establishes the anchor, including on deselection;
   clear/select-all reset it. Reject stale selections/anchors rather than dropping IDs.
   Group order and item order come from the displayed timeline, including active filters.

These choices are implemented and tested; none blocks the lane.
