// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import type { BoardGrouping } from "../lib/board/swimlanes";
import { isSharedTrackerUrl } from "../lib/model/rdf";
import { type GroupMode, groupOptions } from "../lib/views/grouping";
import type { SortMode } from "../lib/views/project-groups";
export interface TasksPreferences {
  /** Projects shared with `sharedOwner`; stored per WebID, never in the browser-wide record. */
  sharedProjects: { url: string; title: string }[];
  /** Favourite tracker document URLs, stored per account alongside shared projects. */
  favourites: string[];
  /** The WebID the account preferences belong to; undefined while signed out. */
  sharedOwner?: string | undefined;
  viewMode: Record<string, "list" | "board">;
  sort: Record<string, SortMode>;
  groupBy: Record<string, GroupMode>;
  boardGrouping: Record<string, BoardGrouping>;
  collapsedSections: string[];
  collapsedProjects: string[];
  sidebar: { labelsOpen: boolean; projectsOpen: boolean };
  showCompletedInProject: boolean;
  weekStart: "monday" | "sunday" | "locale";
}
export const defaultPreferences: TasksPreferences = {
  sharedProjects: [],
  favourites: [],
  viewMode: {},
  sort: {},
  groupBy: {},
  boardGrouping: {},
  collapsedSections: [],
  collapsedProjects: [],
  sidebar: { labelsOpen: true, projectsOpen: true },
  showCompletedInProject: false,
  weekStart: "locale",
};
export type PreferenceAction =
  | { type: "sharedProject"; url: string; title: string }
  | { type: "removeSharedProject"; url: string }
  | { type: "favouriteProject"; url: string; value: boolean }
  | { type: "groupBy"; viewId: string; value: GroupMode }
  | { type: "sort"; viewId: string; value: SortMode }
  | { type: "boardGrouping"; viewId: string; value: BoardGrouping }
  | { type: "viewMode"; viewId: string; value: "list" | "board" }
  | { type: "collapse"; sectionId: string }
  | { type: "collapseProject"; url: string }
  | { type: "sidebar"; group: "labelsOpen" | "projectsOpen" }
  | { type: "showCompleted"; value: boolean }
  | { type: "weekStart"; value: TasksPreferences["weekStart"] };
export function preferencesReducer(
  state: TasksPreferences,
  action: PreferenceAction,
): TasksPreferences {
  switch (action.type) {
    case "favouriteProject": {
      if (!isSharedTrackerUrl(action.url)) return state;
      if (state.favourites.includes(action.url) === action.value) return state;
      return {
        ...state,
        favourites: action.value
          ? [...state.favourites, action.url]
          : state.favourites.filter((url) => url !== action.url),
      };
    }
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
    case "groupBy":
      return { ...state, groupBy: { ...state.groupBy, [action.viewId]: action.value } };
    case "sort":
      return { ...state, sort: { ...state.sort, [action.viewId]: action.value } };
    case "boardGrouping":
      return { ...state, boardGrouping: { ...state.boardGrouping, [action.viewId]: action.value } };
    case "viewMode":
      return { ...state, viewMode: { ...state.viewMode, [action.viewId]: action.value } };
    case "collapse":
      return {
        ...state,
        collapsedSections: state.collapsedSections.includes(action.sectionId)
          ? state.collapsedSections.filter((id) => id !== action.sectionId)
          : [...state.collapsedSections, action.sectionId],
      };
    case "collapseProject":
      return {
        ...state,
        collapsedProjects: state.collapsedProjects.includes(action.url)
          ? state.collapsedProjects.filter((url) => url !== action.url)
          : [...state.collapsedProjects, action.url],
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
      // Account lists are read separately; browser-wide lists are ignored.
      sharedProjects: [],
      favourites: [],
      viewMode: entries(data.viewMode, ["list", "board"]),
      sort: entries(data.sort, ["manual", "due", "priority", "name"]),
      groupBy: entries(data.groupBy, Object.keys(groupOptions) as GroupMode[]),
      boardGrouping: entries(data.boardGrouping, ["none", "priority", "assignee", "label"]),
      collapsedSections: Array.isArray(data.collapsedSections)
        ? data.collapsedSections.filter((id): id is string => typeof id === "string")
        : [],
      collapsedProjects: Array.isArray(data.collapsedProjects)
        ? data.collapsedProjects.filter((url): url is string => typeof url === "string")
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

/** One account's favourite tracker URLs; malformed entries and duplicates are ignored. */
export function parseFavourites(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (url): url is string => typeof url === "string" && isSharedTrackerUrl(url),
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

/** One account's Shared with me list, as stored under its own key. */
export function parseSharedProjects(raw: string | null): TasksPreferences["sharedProjects"] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(value)) return [];
    return [
      ...new Map(
        value
          .filter(validSharedProject)
          .map((project) => [project.url, { url: project.url, title: project.title }]),
      ).values(),
    ];
  } catch {
    return [];
  }
}

function validSharedProject(value: unknown): value is { url: string; title: string } {
  if (!value || typeof value !== "object") return false;
  const project = value as Record<string, unknown>;
  if (typeof project.url !== "string" || typeof project.title !== "string" || !project.title.trim())
    return false;
  return isSharedTrackerUrl(project.url);
}
