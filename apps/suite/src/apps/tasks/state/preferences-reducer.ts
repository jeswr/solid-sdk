// AUTHORED-BY Codex GPT-6
import { isSharedTrackerUrl } from "../lib/model/rdf";
import type { SortMode } from "../lib/views/project-groups";
export interface TasksPreferences {
  sharedProjects: { url: string; title: string }[];
  viewMode: Record<string, "list" | "board">;
  sort: Record<string, SortMode>;
  collapsedSections: string[];
  sidebar: { labelsOpen: boolean; projectsOpen: boolean };
  showCompletedInProject: boolean;
  weekStart: "monday" | "sunday" | "locale";
}
export const defaultPreferences: TasksPreferences = {
  sharedProjects: [],
  viewMode: {},
  sort: {},
  collapsedSections: [],
  sidebar: { labelsOpen: true, projectsOpen: true },
  showCompletedInProject: false,
  weekStart: "locale",
};
export type PreferenceAction =
  | { type: "sharedProject"; url: string; title: string }
  | { type: "removeSharedProject"; url: string }
  | { type: "sort"; viewId: string; value: SortMode }
  | { type: "viewMode"; viewId: string; value: "list" | "board" }
  | { type: "collapse"; sectionId: string }
  | { type: "sidebar"; group: "labelsOpen" | "projectsOpen" }
  | { type: "showCompleted"; value: boolean }
  | { type: "weekStart"; value: TasksPreferences["weekStart"] };
export function preferencesReducer(
  state: TasksPreferences,
  action: PreferenceAction,
): TasksPreferences {
  switch (action.type) {
    case "sharedProject": {
      if (!validSharedProject(action)) return state;
      const previous = state.sharedProjects.find((project) => project.url === action.url);
      if (previous?.title === action.title) return state;
      return {
        ...state,
        sharedProjects: [
          ...state.sharedProjects.filter((project) => project.url !== action.url),
          { url: action.url, title: action.title },
        ],
      };
    }
    case "removeSharedProject":
      return {
        ...state,
        sharedProjects: state.sharedProjects.filter((project) => project.url !== action.url),
      };
    case "sort":
      return { ...state, sort: { ...state.sort, [action.viewId]: action.value } };
    case "viewMode":
      return { ...state, viewMode: { ...state.viewMode, [action.viewId]: action.value } };
    case "collapse":
      return {
        ...state,
        collapsedSections: state.collapsedSections.includes(action.sectionId)
          ? state.collapsedSections.filter((id) => id !== action.sectionId)
          : [...state.collapsedSections, action.sectionId],
      };
    case "sidebar":
      return {
        ...state,
        sidebar: { ...state.sidebar, [action.group]: !state.sidebar[action.group] },
      };
    case "showCompleted":
      return { ...state, showCompletedInProject: action.value };
    case "weekStart":
      return { ...state, weekStart: action.value };
  }
}
export function parsePreferences(raw: string | null): TasksPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaultPreferences;
    const data = value as Record<string, unknown>;
    const entries = <T extends string>(input: unknown, allowed: readonly T[]): Record<string, T> =>
      Object.fromEntries(
        input && typeof input === "object" && !Array.isArray(input)
          ? Object.entries(input).filter((pair): pair is [string, T] => allowed.includes(pair[1]))
          : [],
      );
    const sidebar =
      data.sidebar && typeof data.sidebar === "object"
        ? (data.sidebar as Record<string, unknown>)
        : {};
    return {
      sharedProjects: Array.isArray(data.sharedProjects)
        ? [
            ...new Map(
              data.sharedProjects
                .filter(validSharedProject)
                .map((project) => [project.url, { url: project.url, title: project.title }]),
            ).values(),
          ]
        : [],
      viewMode: entries(data.viewMode, ["list", "board"]),
      sort: entries(data.sort, ["manual", "due", "priority", "name"]),
      collapsedSections: Array.isArray(data.collapsedSections)
        ? data.collapsedSections.filter((id): id is string => typeof id === "string")
        : [],
      sidebar: {
        labelsOpen: typeof sidebar.labelsOpen === "boolean" ? sidebar.labelsOpen : true,
        projectsOpen: typeof sidebar.projectsOpen === "boolean" ? sidebar.projectsOpen : true,
      },
      showCompletedInProject: data.showCompletedInProject === true,
      weekStart:
        data.weekStart === "monday" || data.weekStart === "sunday" ? data.weekStart : "locale",
    };
  } catch {
    return defaultPreferences;
  }
}

function validSharedProject(value: unknown): value is { url: string; title: string } {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  if (typeof project.url !== "string" || typeof project.title !== "string" || !project.title.trim())
    return false;
  return isSharedTrackerUrl(project.url);
}
