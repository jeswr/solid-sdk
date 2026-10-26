<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# PHO-L4 questions and conservative interpretations

1. **Capture representation** — 12-pure-libraries-4.md / PHO-L4 and
   07-parity-backlog.md / Photos specify capture-offset precedence but no input
   representation or DST disambiguation policy. Options: accept unresolved local
   civil times and choose a fold/gap policy, or require resolved instants. This
   library requires epoch milliseconds or a strict ISO timestamp with an explicit
   offset. An optional capture offset preserves EXIF offset metadata for numeric
   instants; otherwise the supplied IANA zone determines the calendar date.
   Unresolved local strings are rejected with a typed error. No system zone or
   upload/modified date is inferred.
2. **Memories boundaries** — PHO-L4 says “across years for a given date” without
   specifying current/future captures or leap-day fallback. Options: all matching
   years, or only prior years; exact February 29, or February 28/March 1 fallback.
   Conservatively select only earlier capture-calendar years, matching the exact
   month/day (February 29 stays February 29).
3. **Virtual grid geometry** — 07-parity-backlog.md / Photos requires sticky day
   headers and justified rows, but PHO-L4 supplies no geometry contract. Options:
   duplicate justified layout here, or expose a structural section model. This
   library exposes headers, fixed-column photo rows, sticky-header indices, and
   half-open section ranges. Pixel measurement/justification remains with the
   caller and the existing library layout helper.
