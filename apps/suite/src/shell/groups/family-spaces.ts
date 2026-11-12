// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol

import { createPodClient } from "@jeswr/storage-client";
import { type FamilySpace, ownerOnlyAccess } from "@jeswr/suite-groups";
import { createCalendar, eventContainer } from "@/apps/calendar/state/repository";
import { createAlbum } from "@/apps/photos/lib/data/albums";
import { photoStorage } from "@/apps/photos/lib/model";
import { TaskStore } from "@/apps/tasks/lib/model/store";
import type { GroupsSession } from "./client";

export function familySpaces(
  session: GroupsSession,
  chosen: string[],
  role: "viewer" | "editor",
): FamilySpace[] {
  const client = () => createPodClient({ fetch: session.fetch, storage: session.storageUrl });
  const privateAccess = async (url: string, owner: string) =>
    owner === session.webId &&
    ownerOnlyAccess({ ...session, storage: (await client()).storage }, url);
  return chosen.map(
    (key): FamilySpace => ({
      key,
      role,
      create: async () => {
        if (key === "calendar") {
          // A fresh calendar: never adopt (and so grant) an existing private calendar/family/.
          const url = await createCalendar(session, "Family", "blue", { exclusive: true });
          return [url, eventContainer(url)];
        }
        if (key === "photos") {
          // Album membership is a reference: Photos extends the album's group access to each
          // photo's document, original and thumbnail as photos are added (album-groups.ts).
          const album = await createAlbum(
            photoStorage(session.fetch, session.storageUrl),
            "Family",
            new Date().toISOString(),
          );
          return [album.url];
        }
        const store = new TaskStore({
          storage: session.storageUrl,
          webId: session.webId,
          fetch: session.fetch,
          ensurePrivateTasksAccess: privateAccess,
          ensurePrivateIndexAccess: privateAccess,
        });
        const project = await store.createProject("Family");
        return [project.url, project.tracker.stateStore as string];
      },
    }),
  );
}
