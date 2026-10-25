<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# PHO-00 interpretations

1. **Should month sharding relocate items or group the fixed item URLs?**
   07-parity-backlog, Photos data mapping and PHO-01 mention month shards but fix metadata at
   `photos/items/<uuid>.ttl`. Conservatively preserve those explicit URLs and expose UTC month/day
   grouping helpers for later hooks, without a second persistent index.
2. **Does strip-location affect only RDF, or also the uploaded original?**
   07-parity-backlog, Photos open points and PHO-01 acceptance name geo triples. Conservatively
   remove location from RDF and require the injected image encoder to remove location metadata
   from the uploaded original. Real encoding stays in PHO-01 per 08-model-first.
3. **Should app-managed trash use a shared index or per-photo records?**
   The Photos section specifies app-managed trash without a record layout. Conservatively use a
   metadata copy at `photos/.trash/<id>.ttl`, retaining the original photograph subject, with a
   PROV entity recording original URL, actor, and invalidation time. Keep binaries until explicit
   purge. Restore uses create-only semantics. Purge only deletes binaries at the app-managed paths
   matching the photo identifier, and refuses imported paths or an existing original description.
   No automatic expiry is inferred.
4. **Should PHO-00 wait for suite-vocab or retain the existing standard IRIs?**
   The 07-parity-backlog cross-cutting rule names `@jeswr/suite-vocab`, but this base has no such
   package. Conservatively retain the standard schema.org, EXIF, Geo, DCT, RDF, and PROV IRIs;
   mint no suite terms or legacy aliases. PHO-01 can import shared constants when that package lands.

These choices do not block the model implementation; confirmation can guide PHO-01 integration.
