// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Read-only port of PM type-index.ts. Index bootstrap/registration belongs to the later SDK.
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { DiscoveryBudget, type DiscoveryBudgetOptions } from "./discovery-budget";
import { inStorage, subjectOf } from "./rdf";

export interface RegisteredLocation {
  forClass: string;
  instance?: string;
  container?: string;
}

/** Preserve both location forms and every valid sibling of malformed foreign values. */
export function registrationsFrom(dataset: DatasetCore): RegisteredLocation[] {
  const subjects = new Map<string, import("@rdfjs/types").Term>();
  for (const quad of dataset)
    subjects.set(`${quad.subject.termType}:${quad.subject.value}`, quad.subject);
  const locations: RegisteredLocation[] = [];
  for (const term of subjects.values()) {
    const node = subjectOf(dataset, term);
    if (!node.types.includes(`${NS.SOLID}TypeRegistration`)) continue;
    for (const forClass of node.iris(`${NS.SOLID}forClass`)) {
      for (const instance of node.iris(`${NS.SOLID}instance`))
        locations.push({ forClass: canonicalize(forClass), instance });
      for (const container of node.iris(`${NS.SOLID}instanceContainer`))
        locations.push({ forClass: canonicalize(forClass), container });
    }
  }
  return locations;
}

export interface DiscoveryFailure {
  url: string;
  error: unknown;
}

/** Read profile and preferences index links once each within the shared discovery budget. */
export async function readTypeIndexes(
  fetch: typeof globalThis.fetch,
  webId: string,
  profile: DatasetCore,
  storage: string,
  options: DiscoveryBudgetOptions = {},
): Promise<{ locations: RegisteredLocation[]; failures: DiscoveryFailure[]; truncated: boolean }> {
  const budget = options.budget ?? new DiscoveryBudget(options);
  const node = subjectOf(profile, webId);
  const links = new Set(
    ["publicTypeIndex", "privateTypeIndex"].flatMap((name) => node.iris(NS.SOLID + name)),
  );
  const pending = [
    ...[...links].map((url) => ({ url, preferences: false })),
    ...[...new Set(node.iris("http://www.w3.org/ns/pim/space#preferencesFile"))].map((url) => ({
      url,
      preferences: true,
    })),
  ];
  const locations: RegisteredLocation[] = [];
  const failures: DiscoveryFailure[] = [];
  for (const { url, preferences } of pending) {
    try {
      if (!inStorage(url, storage))
        throw new TypeError(
          `${preferences ? "Preferences Document" : "Type Index"} is outside the selected storage`,
        );
      const resource = await budget.read(fetch, url);
      if (!resource) break;
      const { dataset } = resource;
      if (preferences) {
        const preferencesNode = subjectOf(dataset, webId);
        for (const name of ["publicTypeIndex", "privateTypeIndex"]) {
          for (const indexUrl of preferencesNode.iris(NS.SOLID + name)) {
            if (links.has(indexUrl)) continue;
            links.add(indexUrl);
            pending.push({ url: indexUrl, preferences: false });
          }
        }
      } else {
        locations.push(...registrationsFrom(dataset));
      }
    } catch (error) {
      budget.throwIfCancelled();
      failures.push({ url, error });
    }
  }
  return { locations, failures, truncated: budget.truncated };
}
