// AUTHORED-BY Codex GPT-6.1-Sol
import type { BuildOptions } from "./model.js";
import type { PodConditions, PodPort } from "./pod-port.js";
/** Fictional identity and fixed clock for offline consumer tests. */
export function exampleBuildOptions(): Required<BuildOptions> {
  return { owner: "https://example.org/people/avery#me", generatedAt: "2026-10-25T12:00:00+00:00" };
}

/** Offline PodPort with defensive byte copies, ETags and conditional mutations. */
export function createMemoryPodPort(identity: { root: string; webId: string }): PodPort {
  const resources = new Map<string, { body: Uint8Array; contentType: string; etag: string }>();
  let version = 0;
  const failure = (status: number) =>
    Object.assign(new Error(`Memory pod HTTP ${status}`), { status });
  const check = (url: string, cond: PodConditions) => {
    const previous = resources.get(url);
    if (
      (cond.ifNoneMatch === "*" && previous) ||
      (cond.ifMatch !== undefined && previous?.etag !== cond.ifMatch)
    )
      throw failure(412);
  };
  return {
    ...identity,
    async read(url) {
      const value = resources.get(url);
      if (!value) throw failure(404);
      return { ...value, body: value.body.slice() };
    },
    async list(container) {
      return [...resources.keys()]
        .filter(
          (url) =>
            url.startsWith(container) &&
            url !== container &&
            !url.slice(container.length).replace(/\/$/, "").includes("/"),
        )
        .map((url) => ({ url, isContainer: url.endsWith("/") }));
    },
    async write(url, body, contentType, cond) {
      check(url, cond);
      const etag = `"${++version}"`;
      resources.set(url, { body: body.slice(), contentType, etag });
      return { etag };
    },
    async delete(url, cond = {}) {
      check(url, cond);
      if (!resources.delete(url)) throw failure(404);
    },
  };
}
