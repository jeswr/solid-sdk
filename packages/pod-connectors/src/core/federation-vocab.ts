// AUTHORED-BY Codex GPT-6.1-Sol
/** Constants from @jeswr/solid-federation-vocab sectors and their alignments.
 * That package currently exports ontology files only; see QUESTIONS.md Q1.
 * Keep this bridge isolated for CON-13's constants-only switch.
 */
export const FEDERATION = {
  MusicRecording: "https://jeswr.org/ns/sectors/media#MusicRecording",
  Playlist: "https://jeswr.org/ns/sectors/media#Playlist",
  CalendarEvent: "https://jeswr.org/ns/sectors/scheduling#CalendarEvent",
  Note: "https://jeswr.org/ns/sectors/social#Note",
} as const;
