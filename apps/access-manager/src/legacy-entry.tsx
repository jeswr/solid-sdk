// AUTHORED-BY Claude Opus 5.5
// The standalone app as it was mounted before it moved into Solid Suite Permissions. The entry
// point no longer mounts it (main.tsx redirects); it stays so its tests keep covering the code.
import { ThemeProvider } from "@jeswr/app-shell";
import type { Root } from "react-dom/client";
import { buildController } from "./auth/controller.js";
import { App } from "./ui/App.jsx";

/**
 * ThemeProvider wraps the real app (suite convention — pod-drive/pod-photos parity): defaults to
 * "system", persists to localStorage "access-manager:app-shell-theme", and toggles the `.dark`
 * class on <html>. Without it the logged-in Shell's ThemeToggle (useTheme) throws.
 */
export function renderLegacyApp(root: Root): void {
  root.render(
    <ThemeProvider storageKey="access-manager:app-shell-theme">
      <App controller={buildController()} />
    </ThemeProvider>,
  );
}
