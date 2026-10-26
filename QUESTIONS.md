<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# CON-10 questions

1. **D4: vocabulary constants.** The federation vocabulary package exports ontology files,
   with no TypeScript constants API. Options: add a new API/dependency, or retain CON-02's
   isolated `core/federation-vocab.ts` bridge. Conservative choice: retain the bridge;
   CON-13 owns the subsequent constants switch.
2. **D4: missing sector equivalents.** Social supplies Note/Feed; health supplies clinical
   observations, not exercise/travel actions; identity supplies people, not online accounts;
   media has playback events, not channel follows. No sector equivalents exist for GitHub
   source repositories/accounts, Discord memberships/accounts, Strava exercise/travel actions,
   Twitch follows, or Notion/Dropbox generic documents and datasets. Options: invent sector
   terms or widen meaning, or retain explicit identity vocab maps for these types.
   Conservative choice: retain legacy types with documented adapter-local identity maps;
   Reddit adds social:Note alongside schema:SocialMediaPosting. Additional mappings need
   vocabulary-owner direction. No false playback, clinical observation or person assertions.
3. **D3: pagination versus durable change cursors.** Options: persist page cursors for
   GitHub/Discord/Twitch/Notion, or exhaust pages and replace complete snapshots. Conservative
   choice: preserve snapshot semantics (including removals) and consume pagination within
   each import; persist Strava's after timestamp, Reddit's newest saved fullname and
   Dropbox's delta cursor. GitHub's since filter cannot describe removals, so keep full
   snapshots. Reddit walks newest-first to its checkpoint (or exhaustion if missing),
   avoiding a bounded before window that could miss new saves. Strava/Reddit APIs do not
   provide deletion tombstones in these increment paths: a cursor-free import replaces
   their snapshots; Dropbox tombstones remove files and folder descendants.
