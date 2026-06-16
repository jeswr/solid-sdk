// AUTHORED-BY Claude Opus 4.8
//
// app-shell-config.ts — the per-app constants the shared @jeswr/app-shell
// FeedbackButton needs: the human APP_NAME (shown in the feedback dialog +
// stamped into diagnostics) and the GitHub REPO the feedback issue is filed
// against ("owner/repo").
//
// TEMPLATED BY create-solid-app: the `__CSA_APP_NAME__` / `__CSA_REPO__` tokens
// below are SUBSTITUTED at scaffold time by `src/scaffold.ts` from the app name
// (and, when given, the `--repo owner/name` flag). So `create-solid-app my-app`
// bakes a sensible APP_NAME, and the feedback button targets the right repo out
// of the box. In the un-scaffolded template (and tests) the tokens fall back to
// safe placeholders so the file still typechecks/builds verbatim.
//
// A scaffolded app can edit these constants freely afterwards — they are plain
// strings, not a build-time secret.

/** The human-readable application name (feedback dialog title + diagnostics). */
export const APP_NAME: string = "__CSA_APP_NAME__".startsWith("__CSA_")
  ? "Solid app"
  : "__CSA_APP_NAME__";

/**
 * The GitHub repository (`owner/repo`) user feedback is filed against. When the
 * scaffolder did not get a `--repo`, this stays the placeholder owner/name; edit
 * it to your app's repo so the FeedbackButton's "Open issue on GitHub" lands in
 * the right tracker.
 */
export const FEEDBACK_REPO: string = "__CSA_REPO__".startsWith("__CSA_")
  ? "your-org/your-repo"
  : "__CSA_REPO__";
