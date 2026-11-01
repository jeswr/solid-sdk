// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectionState } from "../../src/auth/connections.js";
import { ConnectionCard } from "../../src/ui/ConnectionCard.js";
import { PlanReport } from "../../src/ui/Report.js";
import { fakeConnections, samplePlan, sourceRoot, sourceWebId } from "./fixtures.js";

afterEach(cleanup);
const connected: ConnectionState = {
  status: "connected",
  root: sourceRoot,
  roots: [sourceRoot],
  webId: sourceWebId,
  implementation: undefined,
  accessSystem: "acp",
  error: null,
};

describe("server identity on connection cards", () => {
  it.each([
    ["css", "Community Solid Server (CSS)"],
    ["ess", "Enterprise Solid Server (ESS)"],
    ["nss", "Node Solid Server (NSS)"],
    [undefined, "Unknown"],
  ] as const)("shows %s on both connection roles", (implementation, label) => {
    for (const side of ["source", "target"] as const) {
      const view = render(
        <ConnectionCard
          connection={fakeConnections()[0]}
          state={{ ...connected, implementation }}
          side={side}
          disabled={false}
        />,
      );
      expect(screen.getByText("Server type")).toBeVisible();
      expect(screen.getByText(label)).toBeVisible();
      view.unmount();
    }
  });

  it.each([
    ["target", "acp", undefined, true],
    ["target", "acp", "nss", true],
    ["target", "acp", "css", false],
    ["target", "acp", "ess", false],
    ["source", "acp", undefined, false],
    ["target", "wac", undefined, false],
  ] as const)("explains an unestablished ACP target (%s, %s, %s)", (side, accessSystem, implementation, blocked) => {
    render(
      <ConnectionCard
        connection={fakeConnections()[0]}
        state={{ ...connected, accessSystem, implementation }}
        side={side}
        disabled={false}
      />,
    );
    const notice = screen.queryByText(/This pod uses ACP permissions/);
    if (blocked) {
      expect(notice).toBeVisible();
      expect(notice).toHaveTextContent(/Ask your provider to expose the X-Powered-By/);
      expect(notice).toHaveTextContent(/reconnect, or choose another target/);
    } else expect(notice).not.toBeInTheDocument();
  });

  it("keeps an unknown-target plan actionable and offers no writable resolution", () => {
    render(
      <PlanReport
        plan={{
          ...samplePlan,
          targetSystem: "unknown",
          report: [
            {
              id: "unknown",
              kind: "acl-system-unknown",
              severity: "needs-decision",
              resourceUrl: sourceRoot,
              title: "Unrecognized target",
              explanation: "The ACP implementation could not be confirmed.",
              options: [{ id: "abort", label: "Stop migration", description: "No writes." }],
              recommended: "abort",
            },
          ],
        }}
        resolutions={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Go back to options to reconnect or choose another target/,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /Stop migration/ })).toBeVisible();
  });
});
