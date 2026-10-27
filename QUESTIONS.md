<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# PHO-L6 interpretation notes (sst-xv8r)

1. **Centroid and tile-key ordering** — PHO-L6 in `specs/apps/tasks.json` and
   `specs/apps/14-pure-libraries-6.md` name a centroid and a tile key without defining their
   representation. Options: arithmetic coordinate mean, spherical mean, or projected mean;
   numeric tile ordering or lexical ordering. Conservative implementation: the arithmetic mean
   of original latitude/longitude values, with Mercator clamping used only for assigning tiles;
   ties use ascending ASCII `zoom/x/y` keys. Members retain input order. At zoom 0 this means
   longitudes on opposite sides of the date line average numerically, rather than wrapping.

2. **Boundary tiles and invalid clustering arguments** — the same task allows longitude ±180
   and zoom 0–20 but does not define edge assignment or malformed IDs/zoom. Options: wrap +180
   to the western edge or keep it at the eastern edge; coerce malformed arguments or reject.
   Conservative implementation: clamp tile indices to the grid, so +180 stays in the last
   column and -180 in the first; require an integer zoom and unique, non-blank string IDs.
   Reject malformed lists/IDs with `INVALID_POINTS` and zoom with `INVALID_ZOOM`, using the
   same exported error class as `INVALID_COORDINATE` and `TOO_MANY_POINTS`. Check list length
   before zoom validation or member access. No blocking question remains for this lane.
