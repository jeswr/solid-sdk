// AUTHORED-BY Codex GPT-6.1-Sol
import { type ContainerMember, readContainerMembers } from "@jeswr/ldp-container";
import { assertWithinBase } from "./keys.js";

export type { ContainerMember } from "@jeswr/ldp-container";

/** List direct members; null means a missing container (404/410). */
export async function listContainer(
  containerUrl: string,
  base: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<ContainerMember[] | null> {
  assertWithinBase(base, containerUrl);
  const members = await readContainerMembers(fetchImpl, containerUrl, {
    scope: base,
    package: "unstorage-solid",
  });
  // Keep the legacy delegate's stricter root-alias rules, including repeated slashes.
  return members === null
    ? null
    : members.filter((member) => {
        try {
          assertWithinBase(base, member.url);
          return true;
        } catch {
          return false;
        }
      });
}
