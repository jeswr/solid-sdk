// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { Store } from "n3";
import type { PodSession } from "../../../lib/session/pod-session";
import { type AgentClient, AgentReadError } from "./client";
import { AGENT, metadataNode, PROV, RDF } from "./paths";

// Keep this module usable in native staging, where the demo-pod seed is removed.
const ROOT = "https://alice.demo.pod/";
export const DEMO_HEARTBEAT_MS = 60_000;
export function isDemoAgentSession(session: PodSession): boolean {
  return (
    session.mode === "demo" &&
    session.storageUrl === ROOT &&
    session.webId === `${ROOT}profile/card#me`
  );
}

/** A heartbeat only: no execution, signing, approvals, tokens or provider calls. */
export function startDemoAgent(session: PodSession, client: AgentClient): () => void {
  if (!isDemoAgentSession(session) || client.workspace !== `${ROOT}agent/`) return () => {};
  let active = true;
  let writing = false;
  const refresh = async () => {
    if (writing) return;
    writing = true;
    try {
      let etag: string | null = null;
      let missing = false;
      try {
        etag = (await client.graph(client.paths.heartbeat)).etag;
      } catch (error) {
        if (!(error instanceof AgentReadError) || ![404, 410].includes(error.status)) throw error;
        missing = true;
      }
      const store = new Store();
      const node = metadataNode(store, client.paths.heartbeat);
      node.setIri(`${RDF}type`, `${AGENT}Heartbeat`);
      node.setText(`${PROV}generatedAtTime`, new Date().toISOString());
      const body = await serialize([...store], { format: "text/turtle" });
      if (!active) return;
      if (missing) await client.create(client.paths.heartbeat, body);
      else if (etag) await client.replace(client.paths.heartbeat, body, etag);
    } catch {
      // An offline demo or another tab's ETag win retries on the next tick/focus.
    } finally {
      writing = false;
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), DEMO_HEARTBEAT_MS);
  const visible = () => {
    if (document.visibilityState !== "hidden") void refresh();
  };
  document.addEventListener("visibilitychange", visible);
  return () => {
    active = false;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visible);
  };
}
