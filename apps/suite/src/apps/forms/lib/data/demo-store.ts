// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import type { PodSession } from "@/lib/session/pod-session";
import { sampleForms } from "../../demo/sample";
import { createMemoryFormsStore } from "./memory-store";
import type { DemoSnapshot, FormsStore } from "./store";

async function readSnapshot(response: Response): Promise<DemoSnapshot> {
  const snapshot = (await response.json()) as DemoSnapshot;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.forms) ||
    !Array.isArray(snapshot.responses)
  )
    throw new Error("Unsupported demo forms snapshot");
  return snapshot;
}

/** Demo JSON stays in the demo pod, never a real user's storage. */
export async function openDemoFormsStore(session: PodSession): Promise<FormsStore> {
  if (session.mode !== "demo") throw new Error("The demo store requires a demo session");
  return openSnapshot(session, 0);
}
async function openSnapshot(session: PodSession, retries: number): Promise<FormsStore> {
  const url = new URL("forms/demo.json", session.storageUrl).href;
  const response = await session.fetch(url, { redirect: "error" });
  if (!response.ok && response.status !== 404) throw new Error("Couldn't open demo forms");
  let etag = response.headers.get("etag");
  const persist = async (snapshot: DemoSnapshot) => {
    if (!etag) throw new Error("A version is needed to save safely");
    const result = await session.fetch(url, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "application/json", "if-match": etag },
      body: JSON.stringify(snapshot),
    });
    if (result.status === 412) {
      const latest = await session.fetch(url, { redirect: "error", cache: "no-store" });
      if (!latest.ok) throw new Error("Couldn't refresh demo forms. Try saving again.");
      const refreshed = await readSnapshot(latest);
      etag = latest.headers.get("etag");
      return refreshed;
    }
    if (!result.ok) throw new Error("Couldn't save demo forms. Reload before trying again.");
    etag = result.headers.get("etag");
  };
  let initial: DemoSnapshot;
  if (response.status === 404) {
    initial = sampleForms(session.storageUrl);
    const created = await session.fetch(url, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify(initial),
    });
    if (created.status === 412) {
      if (retries === 3)
        throw new Error("Couldn't seed demo forms after three retries. Reload to try again.");
      return openSnapshot(session, retries + 1);
    }
    if (!created.ok) throw new Error("Couldn't seed demo forms");
    etag = created.headers.get("etag");
  } else {
    initial = await readSnapshot(response);
  }
  return createMemoryFormsStore(session.storageUrl, initial, persist);
}
