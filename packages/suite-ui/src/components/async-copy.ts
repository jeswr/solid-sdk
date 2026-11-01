// AUTHORED-BY Codex GPT-6.1-Sol
/** Categories returned by the façade's classifyError; never inspect raw errors in UI code. */
export const errorStateCopy = {
  reauth: { title: "Sign in to continue", actions: ["signIn"] },
  forbidden: {
    title: "You don't have access to this",
    actions: ["requestAccess", "switchAccount"],
  },
  "not-found": { title: "This item isn't here any more", actions: ["goToParent", "home"] },
  conflict: { title: "This item changed somewhere else", actions: ["resolveConflict"] },
  "name-taken": { title: "A file with this name already exists", actions: [] },
  quota: { title: "Your pod is full", actions: ["manageStorage"] },
  "too-large": { title: "This file is too large for your storage", actions: [] },
  offline: { title: "Not available offline", actions: ["retry"] },
  unreachable: { title: "Can't reach your storage", actions: ["retry", "showSavedCopies"] },
  unsupported: { title: "Not available on this storage", actions: [] },
  unknown: { title: "Something went wrong", actions: ["reload", "report"] },
} as const;

export type ErrorCategory = keyof typeof errorStateCopy;
export type ErrorAction = (typeof errorStateCopy)[ErrorCategory]["actions"][number];
export const errorActionLabels: Record<ErrorAction, string> = {
  signIn: "Sign in",
  requestAccess: "Request access",
  switchAccount: "Switch account",
  goToParent: "Go to parent",
  home: "Home",
  resolveConflict: "Review changes",
  manageStorage: "Manage storage",
  retry: "Retry",
  showSavedCopies: "Show saved copies",
  reload: "Reload",
  report: "Report a problem",
};
