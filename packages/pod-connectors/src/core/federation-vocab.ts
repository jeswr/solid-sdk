// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";

/** Federation terms built from the suite's canonical namespace bases. */
export const FEDERATION = {
  MusicRecording: `${NS.MEDIA}MusicRecording`,
  Playlist: `${NS.MEDIA}Playlist`,
  CalendarEvent: `${NS.SCHEDULING}CalendarEvent`,
  CreativeWork: `${NS.MEDIA}CreativeWork`,
  ListeningActivity: `${NS.MEDIA}ListeningActivity`,
  MediaAccount: `${NS.MEDIA}MediaAccount`,
  HealthRecord: `${NS.HEALTH}HealthRecord`,
  TransactionRecord: `${NS.FINANCE}TransactionRecord`,
  Note: `${NS.SOCIAL}Note`,
  Person: `${NS.CORE}Person`,
  Agent: `${NS.CORE}Agent`,
  AccountHolder: `${NS.CORE}AccountHolder`,
  AccountProvider: `${NS.CORE}AccountProvider`,
  Activity: `${NS.CORE}Activity`,
} as const;

export const FEDERATION_PROPERTIES = {
  title: "http://purl.org/dc/terms/title",
  content: `${NS.SOCIAL}content`,
  about: `${NS.CORE}about`,
  subject: `${NS.CORE}subject`,
  hasAccountHolder: `${NS.CORE}hasAccountHolder`,
  hasAccountProvider: `${NS.CORE}hasAccountProvider`,
} as const;
