// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredProject } from "../model/store";

export interface ProjectNode {
  project: StoredProject;
  parentUrl: string | undefined;
  depth: number;
  readable: boolean;
}
export const MAX_PROJECT_DEPTH = 3;
// Trackers in one project collection share a pod boundary. Never follow parent IRIs.
const collection = (project: StoredProject) => new URL("./", project.url).href;

/** Invalid ancestry is presentation-only: preserve the original RDF for other clients. */
export function projectHierarchy(
  projects: readonly StoredProject[],
  unreadable: readonly string[] = [],
): ProjectNode[] {
  const active = projects.filter((project) => !project.tracker.archivedAt);
  const byId = new Map(active.map((project) => [project.tracker.id, project]));
  const parents = new Map<string, string>();
  for (const project of active) {
    const parent = byId.get(project.tracker.parent ?? "");
    if (
      parent &&
      !unreadable.includes(project.url) &&
      !unreadable.includes(parent.url) &&
      collection(parent) === collection(project)
    )
      parents.set(project.url, parent.url);
  }
  const ancestors = (url: string) => {
    const seen = new Set([url]);
    let parent = parents.get(url);
    while (parent) {
      if (seen.has(parent)) return undefined;
      seen.add(parent);
      parent = parents.get(parent);
    }
    return seen;
  };
  // Inspect every chain before changing edges, so every cycle member becomes a root.
  const invalid = active.filter((project) => !ancestors(project.url));
  for (const project of invalid) parents.delete(project.url);
  const tooDeep = active.filter(
    (project) => (ancestors(project.url) as Set<string>).size > MAX_PROJECT_DEPTH,
  );
  for (const project of tooDeep) parents.delete(project.url);
  const nodes = active.map((project) => ({
    project,
    parentUrl: parents.get(project.url),
    depth: (ancestors(project.url) as Set<string>).size,
    readable: !unreadable.includes(project.url),
  }));
  const visit = (parentUrl: string | undefined): ProjectNode[] =>
    nodes
      .filter((node) => node.parentUrl === parentUrl)
      .flatMap((node) => [node, ...visit(node.project.url)]);
  return visit(undefined);
}

export function projectDescendants(tree: readonly ProjectNode[], url: string): ProjectNode[] {
  const children = tree.filter((node) => node.parentUrl === url);
  return children.flatMap((child) => [child, ...projectDescendants(tree, child.project.url)]);
}

/** Stored edges are authoritative for mutations, including edges hidden for display. */
function storedParents(tree: readonly ProjectNode[]): Map<string, string> {
  const byId = new Map(tree.map((node) => [node.project.tracker.id, node.project]));
  const parents = new Map<string, string>();
  for (const { project } of tree) {
    const parent = byId.get(project.tracker.parent ?? "");
    if (parent && collection(parent) === collection(project)) parents.set(project.url, parent.url);
  }
  return parents;
}

export function storedProjectDescendants(tree: readonly ProjectNode[], url: string): ProjectNode[] {
  const parents = storedParents(tree);
  const seen = new Set([url]);
  const result: ProjectNode[] = [];
  const pending = tree.filter((node) => parents.get(node.project.url) === url).reverse();
  while (pending.length) {
    const node = pending.pop() as ProjectNode;
    if (seen.has(node.project.url)) continue;
    seen.add(node.project.url);
    result.push({ ...node, parentUrl: parents.get(node.project.url) });
    pending.push(
      ...tree.filter((child) => parents.get(child.project.url) === node.project.url).reverse(),
    );
  }
  return result;
}

export function canMoveProject(
  tree: readonly ProjectNode[],
  url: string,
  parentUrl: string | undefined,
): boolean {
  const source = tree.find((node) => node.project.url === url);
  if (!source?.readable) return false;
  const parent = tree.find((node) => node.project.url === parentUrl);
  if (
    parentUrl !== undefined &&
    (!parent?.readable ||
      parentUrl === url ||
      collection(source.project) !== collection(parent.project))
  )
    return false;
  const parents = storedParents(tree);
  const affected = [source, ...storedProjectDescendants(tree, url)];
  if (parentUrl === undefined) parents.delete(url);
  else parents.set(url, parentUrl);
  // Walk the proposed stored chains. The depth bound also bounds corrupt cyclic input.
  for (const node of affected) {
    let current: string | undefined = node.project.url;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current) || seen.size === MAX_PROJECT_DEPTH) return false;
      seen.add(current);
      current = parents.get(current);
    }
  }
  return true;
}

export function projectBreadcrumb(tree: readonly ProjectNode[], url: string): StoredProject[] {
  const current = tree.find((node) => node.project.url === url);
  if (!current) return [];
  return [
    ...(current.parentUrl ? projectBreadcrumb(tree, current.parentUrl) : []),
    current.project,
  ];
}
