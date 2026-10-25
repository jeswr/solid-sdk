<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SKL-01 scope interpretations

1. **Detailed source name differs from an existing skill (DESIGN §2 D1–D2).**
   Options: rename/remove `solid-optimistic-ui`, duplicate the full detailed source,
   or retain its condensed text and link to the new `solid-app-shell` guide.
   Chosen: retain both names, preserve the existing quick reference, and link to
   `solid-app-shell` for the detailed source. This follows the explicit 14 + 6 inventory.

2. **Top-level and package offline skills share a name (DESIGN §2 D1–D2, D4).**
   Options: rename the package skill now, omit the requested top-level skill, or keep
   both in place and defer naming/index handling to SKL-03.
   Chosen: keep both files, as D1 requires package skills to stay where they are and
   D2 explicitly requests `skills/solid-offline`. The package skill governs the API;
   the top-level skill keeps caching patterns. SKL-03 must reconcile this with D4's
   duplicate-name validation rule. No validator or sync behavior is introduced here.

3. **Detailed source companions include runnable TypeScript/JavaScript (DESIGN §2 D1).**
   Options: import them as executable workspace code, drop them, or preserve them as
   fenced Markdown references. Chosen: preserve every companion as a linked reference,
   retaining the source filename in the document name and explaining extraction.
   This keeps the material without introducing auth forks, tests, or dependencies.

4. **Source references describe repositories outside this checkout (DESIGN §2 D1–D2).**
   Options: invent local replacements, drop the references, or preserve their original
   context. Chosen: update paths for imported SDK packages/apps and skill companions;
   retain historical commit links and explicitly attribute server paths/ADRs to
   `prod-solid-server`. Resources absent from the supplied snapshots remain links to
   their original guide. Package API guidance wins over historical availability notes.

These interpretations do not block SKL-01. The duplicate-name rule needs resolution
in SKL-03; the remaining choices need no additional design decision for this lane.
