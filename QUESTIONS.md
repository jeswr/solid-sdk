<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-L1 interpretation

1. The MUS-L1 task in `specs/apps/tasks.json` and `09-pure-libraries.md` do not
   prescribe an output shape, duration units, absent-field values, multi-artist
   selection or malformed-file policy. Options are a raw dependency result or a
   small app-facing record. Conservative choice: `extractAudioMetadata(ArrayBuffer)`
   returns only the eight requested fields, with duration in seconds, null for
   missing values, track/disc numbers without totals, the first tagged artist and
   the first embedded picture's MIME. Parser failures reject; recoverable damage
   can return partial metadata. No filename inference, I/O or artwork loading.
   This does not block implementation; the choice is documented at the API.
