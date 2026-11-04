// AUTHORED-BY Claude Opus 5.5
// The MCP lockdown console: every connected system (an MCP adapter) and each of its tools,
// with whether the agent is offered it and why. Switching a system or an action off writes a
// prohibition into the agent's rules; the list the MCP client sees is fetched live over MCP.
import { createSandbox, nameOf, type ToolSpec } from "@jeswr/agent-sandbox";
import { createMcpProxy } from "@jeswr/agent-sandbox/mcp";
import { AGENT_ID, createWorld, DIRECTORY, PURPOSE, SYSTEM } from "@jeswr/agent-sandbox/world";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { useEffect, useMemo, useState } from "react";
import type { Shared } from "../App.js";
import { Section, Toggle } from "../components.js";

export function Systems({ shared }: { shared: Shared }) {
  const { settings, setSettings } = shared;
  const world = useMemo(() => createWorld(), []);
  world.setSettings(settings);
  const sandbox = useMemo(
    () =>
      createSandbox({
        tools: world.tools,
        rules: world.rules,
        directory: world.directory,
        agent: AGENT_ID,
        purpose: PURPOSE.customerCare,
      }),
    [world],
  );
  const catalogue = sandbox.catalogue();
  const systems = Object.values(SYSTEM);
  const [mcpTools, setMcpTools] = useState<string[]>();

  // Ask the real MCP proxy, over the MCP protocol, what an agent connected to it would see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch whenever the rules change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      const server = createMcpProxy(sandbox, { name: "harbour-finch", version: "0.1.0" });
      const client = new Client({ name: "demo-client", version: "0.1.0" });
      await Promise.all([server.connect(b), client.connect(a)]);
      const listed = await client.listTools();
      if (!cancelled) setMcpTools(listed.tools.map((t) => t.name));
      await client.close();
    })().catch(() => !cancelled && setMcpTools([]));
    return () => {
      cancelled = true;
    };
  }, [sandbox, settings]);

  const lockedSystem = (system: string) => settings.lockedSystems.includes(system);
  const lockedAction = (t: ToolSpec) =>
    settings.lockedActions.some((l) => l.system === t.system && l.action === t.action);
  const toggleSystem = (system: string, on: boolean) =>
    setSettings({
      ...settings,
      lockedSystems: on
        ? settings.lockedSystems.filter((s) => s !== system)
        : [...settings.lockedSystems, system],
    });
  const toggleAction = (t: ToolSpec, on: boolean) =>
    setSettings({
      ...settings,
      lockedActions: on
        ? settings.lockedActions.filter((l) => !(l.system === t.system && l.action === t.action))
        : [...settings.lockedActions, { system: t.system, action: t.action }],
    });

  return (
    <div className="page">
      <Section
        title="Connected systems"
        intro="Each system is connected to the agent through an adapter (for example an MCP server). The sandbox sits between the agent and every adapter: it offers only the tools the rules allow, says why each one is hidden, and checks every call. Switch a whole system off, or one kind of action on it."
      >
        <div className="systems">
          {systems.map((system) => {
            const tools = catalogue.filter((e) => e.tool.system === system);
            const on = !lockedSystem(system);
            return (
              <div key={system} className={on ? "card system" : "card system off"}>
                <div className="system-head">
                  <h3>
                    {nameOf(DIRECTORY, system)
                      .replace(/^the /, "")
                      .replace(/^./, (c) => c.toUpperCase())}
                  </h3>
                  <Toggle
                    checked={on}
                    onChange={(v) => toggleSystem(system, v)}
                    label={on ? "Connected" : "Locked"}
                  />
                </div>
                <ul className="tools">
                  {tools.map(({ tool, visible, reason }) => {
                    const siblings = tools
                      .filter((x) => x.tool !== tool && x.tool.action === tool.action)
                      .map((x) => x.tool.title);
                    return (
                      <li key={tool.name} className={visible ? "tool shown" : "tool hidden"}>
                        <div className="tool-row">
                          <span>
                            <strong>{tool.title}</strong> <code>{tool.name}</code>
                          </span>
                          <span className={visible ? "badge badge-permit" : "badge badge-stop"}>
                            {visible ? "Offered" : "Hidden"}
                          </span>
                        </div>
                        <p className="hint">{reason}</p>
                        {on && (
                          <Toggle
                            checked={!lockedAction(tool)}
                            onChange={(v) => toggleAction(tool, v)}
                            label="Allow this action"
                            hint={
                              siblings.length
                                ? `Rules are per action, so this also covers: ${siblings.join(", ")}.`
                                : undefined
                            }
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="What an agent connected over MCP sees"
        intro="This list comes from a real MCP server (the sandbox's lockdown proxy) answering a real tools/list request in your browser."
      >
        <div className="card">
          {mcpTools === undefined ? (
            <p className="hint">Asking the MCP server…</p>
          ) : (
            <p>
              {mcpTools.length} of {catalogue.length} tools offered:{" "}
              {mcpTools.map((n) => (
                <code key={n} className="pill">
                  {n}
                </code>
              ))}
            </p>
          )}
          <p className="hint">
            To try it with your own MCP client (Claude Desktop, Claude Code), run the same proxy
            from the solid-sdk repository:{" "}
            <code>
              pnpm --filter @jeswr/agent-sandbox build && node
              packages/agent-sandbox/dist/mcp/cli.js --story injected-refund
            </code>
            . Every decision is printed to the terminal as it happens.
          </p>
        </div>
      </Section>
    </div>
  );
}
