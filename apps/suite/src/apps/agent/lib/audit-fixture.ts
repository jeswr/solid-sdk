// AUTHORED-BY Codex GPT-6.1-Sol
import { type AuditEntry, GENESIS, sealAudit } from "./audit";
/** Synthetic body-free entries for the large timeline acceptance fixture. */
export function activityFixture(size = 5000): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let prev = GENESIS;
  for (let seq = 1; seq <= size; seq++) {
    const entry = sealAudit(seq, new Date(Date.UTC(2026, 10, 1) + seq * 1000).toISOString(), prev, {
      type: "ingest",
      id: `urn:fixture:${seq}`,
      agent: "https://alice.demo.pod/agent/#agent",
      owner: "https://alice.demo.pod/profile/card#me",
    });
    entries.push(entry);
    prev = entry.hash;
  }
  return entries;
}
