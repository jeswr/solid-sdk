<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Owned audio

`uploadMusicFile` takes decoded file bytes, MIME type and optional same-named LRC text.
Browser file reads stay in the UI. Tags come from `lib/metadata`; embedded JPEG, PNG and
WebP covers and the LRC sidecar are stored beside the audio in `music/files/`. Resource
names use the first 32 hexadecimal characters of the audio's SHA-256 digest, computed
with `crypto.subtle`. Audio, artwork and lyrics use create-only PUTs; a 412 accepts only
byte-identical content, comparing SHA-256 digests after checking the byte lengths. Failed
attempts re-read the library before best-effort deletion of binaries they created, keeping
anything referenced as audio, lyrics or album artwork. If that read fails, the binaries are
retained. Retrying the same file targets the same resources.

The recording target is selected before writing any binary. Tagged recordings match on
title and first artist (NFKC, English lowercase, collapsed whitespace), with agreeing albums
when both have one and durations within 3 seconds when both have a duration. Among several
candidates, a unique exact album and track-number match wins; otherwise a new recording is
created. Files without either title or artist tags always create a new recording, using the
filename, Unknown artist and Unknown album as display fallbacks. An already linked resource
identifies a retry even without tags. A matched recording that already has audio is skipped
with “Already in your library”. New recordings use the content URL's fingerprint, avoiding
collisions between versions. Existing fields, artist names, credits, albums, likes, playlist
membership and source links are retained; only blanks are filled. Metadata writes use ETags
and bounded re-read/merge on 412. Embedded art fills only an empty album cover; an album cover
chosen concurrently is kept. Artwork and lyrics binaries are only uploaded for empty fields.

Drive picking uses Drive's typed container listing helper with pod-scoped fetch, recursively
lists audio under `drive/`, and links the authenticated original without copying or writing
to Drive. Deleting or moving that original can make a library song unavailable.

Playback fetches the **entire audio blob** through the authenticated pod fetch for this cut;
large files therefore consume memory and wait for download before playing. Audio object URLs are
revoked on track change and teardown; restarting the current file seeks without downloading
it again. Pod artwork shares one authenticated fetch and object URL per cover within a session,
revoked after its last consumer unmounts. Browser codec support varies; decode failures offer a
retry. Album artwork in the pod is authenticated and always available; remote artwork still
requires the existing privacy opt-in.

History uses the normal month-sharded writer and `schema:ListenAction`/`media:PlaybackEvent`
shape, with agent `https://solid-suite.app/music` displayed as “Solid Suite”. A pure helper
qualifies a listen at 30 seconds or half a known positive duration, whichever comes first.
The audio adapter accumulates actual listening time; seeking, paused time and downloads do
not count. Each queue occurrence/restart gets a stable event ID for conditional-write retries.
