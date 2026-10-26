<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# CON-09 questions

1. DESIGN §2 D6 refers to `@jeswr/solid-listening`, which is absent from this checkout.
   Options: block on importing it, or use the federation media SHACL contract that explicitly
   incorporates its wire shape. Conservative choice: use that local contract: PlaybackEvent
   links `media:playedWork` to a Track and `core:atTime` to a named `time:Instant` carrying
   `time:inXSDDateTime`; the listener remains implicit, and actual listening duration is omitted
   because recently-played supplies track length, not time listened. Direct package comparison
   remains unverified.
2. DESIGN §2 D6 does not define the host refresh interface or cursor encoding. Options: change
   the shared ports, or expose a Spotify-specific SourceAuth factory and document an opaque
   cursor. Conservative choice: preserve the shared ports; export `createSpotifySourceAuth`
   from the Spotify entry point. Store `after:<epoch-ms>` on successful completion; accept
   `before:<epoch-ms>` for explicit history imports. Other library resources remain snapshots.
