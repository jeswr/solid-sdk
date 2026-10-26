// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Constants from @jeswr/solid-federation-vocab sectors and their alignments.
 * That package currently exports ontology files only; see QUESTIONS.md Q1.
 * Keep this bridge isolated for CON-13's constants-only switch.
 */
export const FEDERATION = {
  MusicRecording: "https://jeswr.org/ns/sectors/media#MusicRecording",
  Playlist: "https://jeswr.org/ns/sectors/media#Playlist",
  CalendarEvent: "https://jeswr.org/ns/sectors/scheduling#CalendarEvent",
  CreativeWork: "https://jeswr.org/ns/sectors/media#CreativeWork",
  ListeningActivity: "https://jeswr.org/ns/sectors/media#ListeningActivity",
  MediaAccount: "https://jeswr.org/ns/sectors/media#MediaAccount",
  HealthRecord: "https://jeswr.org/ns/sectors/health#HealthRecord",
  TransactionRecord: "https://jeswr.org/ns/sectors/finance#TransactionRecord",
  Note: "https://jeswr.org/ns/sectors/social#Note",
  Person: "https://jeswr.org/ns/core#Person",
  Activity: "https://jeswr.org/ns/core#Activity",
} as const;

export const FEDERATION_PROPERTIES = {
  title: "http://purl.org/dc/terms/title",
  content: "https://jeswr.org/ns/sectors/social#content",
  about: "https://jeswr.org/ns/core#about",
  subject: "https://jeswr.org/ns/core#subject",
} as const;
