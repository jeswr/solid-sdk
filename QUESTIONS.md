<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-00 questions and conservative defaults

1. **Artwork default** (07-parity-backlog, Music / Artwork and Open points): hot-link by default, cache on import, or no artwork until opt-in? This model defaults to `none`; `hot-link` requires an explicit preference. Caching and connector changes remain outside this lane.
2. **Stats windows** (07-parity-backlog, Music / Screens): local midnight or UTC for Today; rolling days or calendar months/years for 1M/1Y? This model uses UTC midnight and inclusive rolling 7/30/365-day windows, excludes future plays, and accepts an explicit clock. MUS-01 can adapt this if product policy changes.
3. **Liked interop persistence** (07-parity-backlog, Music / Data mapping): atomically persist the track flag and `playlists/liked.ttl`, or independently persist both with recovery? The pure model exposes `syncLikedPlaylist` and conditional document writes; cross-document transaction/recovery belongs to MUS-01, with `media:loved` as the source of truth.
