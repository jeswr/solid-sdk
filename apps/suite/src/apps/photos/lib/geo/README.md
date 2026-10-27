<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Photos geographic helpers (PHO-L6)

Pure TypeScript; import the public API from `./index`. No network, UI, or map tiles.
Coordinates use `{ latitude, longitude }` in signed WGS-84 decimal degrees, matching the EXIF
reader's `gps` shape. `createCoordinate` and `fromExifGps` return a fresh coordinate with
`suspicious: true` only at (0, 0). Negative zero is normalized to zero.

`fromExifGps` takes `{ latitude, latitudeRef, longitude, longitudeRef }`. Each axis is exactly
three `[numerator, denominator]` pairs for degrees, minutes, seconds. Numerators and denominators
must be safe unsigned integers, with positive denominators; references are uppercase N/S or E/W
on the appropriate axis. Decimal tags, strings, negative rationals, and missing tags are rejected.

`formatDecimal` returns `"51.507333, -0.127667"`; `formatDms` returns
`"51°30′26.4″N, 0°7′39.6″W"`. Seconds round to one decimal place, carrying into minutes/degrees.
`toGeoUri` and `toOpenStreetMapUrl` serialize six decimal places; the latter sets map zoom 16.
The URI follows [RFC 5870](https://www.rfc-editor.org/rfc/rfc5870.html), with no invented altitude.
`haversineDistance` returns metres using `MEAN_EARTH_RADIUS_METRES` (6371008.8).

`clusterPoints(points, zoom)` requires an array of `{ id, latitude, longitude }` with unique,
non-blank string IDs and integer zoom 0–20. It checks `MAX_CLUSTER_POINTS` (200000) before
reading members. Each [Web Mercator tile](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames)
becomes `{ count, centroid, memberIds }`. Latitudes clamp at `MERCATOR_MAX_LATITUDE` only for
tile assignment; centroids average original coordinates, including at zoom 0 across the date
line. Tile indices stay in `[0, 2 ** zoom - 1]`, including at ±180. Clusters sort by count
descending, then ASCII `zoom/x/y` ascending. IDs retain input order; inputs are never mutated.

All invalid input throws `GeoError` with a static message and machine-readable `code`:
`INVALID_COORDINATE`, `INVALID_POINTS`, `INVALID_ZOOM`, or `TOO_MANY_POINTS`. The length error
takes precedence over invalid zoom or invalid members. Coordinates outside ±90/±180 are
rejected everywhere, including clustering; no coordinate wrapping or geographic clamping occurs.
