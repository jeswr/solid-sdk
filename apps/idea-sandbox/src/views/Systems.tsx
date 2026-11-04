// AUTHORED-BY Claude Opus 5.5
// The MCP lockdown console: every connected system (an MCP adapter) and each of its tools,
// with whether the agent is offered it and why. Switching a system or an action off writes a
// prohibition into the agent's rules; the list the MCP client sees is fetched live over MCP.
import { type CatalogueEntry, createSandbox, nameOf, type ToolSpec } from "@jeswr/agent-sandbox";
import { createMcpProxy } from "@jeswr/agent-sandbox/mcp";
import { AGENT_ID, createWorld, DIRECTORY, PURPOSE, SYSTEM } from "@jeswr/agent-sandbox/world";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { useEffect, useMemo, useState } from "react";
import type { Shared } from "../App.js";
import { Section, Toggle } from "../components.js";

type Choice = "allow" | "ask" | "block";

const CHOICES: readonly { id: Choice; label: string }[] = [
  { id: "allow", label: "As the rules say" },
  { id: "ask", label: "Ask a person" },
  { id: "block", label: "Blocked" },
];

function ActionChoice({
  name,
  value,
  onChange,
  hint,
}: {
  name: string;
  value: Choice;
  onChange: (c: Choice) => void;
  hint?: string | undefined;
}) {
  return (
    <fieldset className="choice">
      <legend className="visually-hidden">What the agent may do with {name}</legend>
      {CHOICES.map((c) => (
        <label
          key={c.id}
          className={c.id === value ? `choice-option active ${c.id}` : "choice-option"}
        >
          <input
            type="radio"
            name={`choice-${name}`}
            checked={c.id === value}
            onChange={() => onChange(c.id)}
          />
          {c.label}
        </label>
      ))}
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

const CLI_STORY = "injected-refund";

/** Claude Code's own controls, compiled from the same catalogue (defence in depth). */
function claudeCodeConfig(catalogue: readonly CatalogueEntry[]) {
  const tool = (e: CatalogueEntry) => `mcp__harbour-finch__${e.tool.name}`;
  const args = ["packages/agent-sandbox/dist/mcp/cli.js", "--story", CLI_STORY];
  const mcp = { mcpServers: { "harbour-finch": { type: "stdio", command: "node", args } } };
  const managed = {
    allowManagedPermissionRulesOnly: true,
    allowManagedMcpServersOnly: true,
    allowedMcpServers: [{ serverCommand: ["node", ...args] }],
    permissions: {
      disableBypassPermissionsMode: "disable",
      allow: catalogue.filter((e) => e.visible && !e.approval).map(tool),
      ask: catalogue.filter((e) => e.visible && e.approval).map(tool),
      deny: catalogue.filter((e) => !e.visible).map(tool),
    },
  };
  return { mcp: JSON.stringify(mcp, null, 2), managed: JSON.stringify(managed, null, 2) };
}

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
  const config = claudeCodeConfig(catalogue);

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
  const same = (t: ToolSpec) => (l: { system: string; action: string }) =>
    l.system === t.system && l.action === t.action;
  const choiceOf = (t: ToolSpec): Choice =>
    settings.lockedActions.some(same(t))
      ? "block"
      : (settings.reviewActions ?? []).some(same(t))
        ? "ask"
        : "allow";
  const toggleSystem = (system: string, on: boolean) =>
    setSettings({
      ...settings,
      lockedSystems: on
        ? settings.lockedSystems.filter((s) => s !== system)
        : [...settings.lockedSystems, system],
    });
  const choose = (t: ToolSpec, choice: Choice) => {
    const entry = { system: t.system, action: t.action };
    const others = (list: readonly { system: string; action: string }[] = []) =>
      list.filter((l) => !same(t)(l));
    setSettings({
      ...settings,
      lockedActions: [...others(settings.lockedActions), ...(choice === "block" ? [entry] : [])],
      reviewActions: [...others(settings.reviewActions), ...(choice === "ask" ? [entry] : [])],
    });
  };

  return (
    <div className="page">
      <Section
        title="Connected systems"
        intro="Each system is connected to the agent through an adapter (for example an MCP server). The sandbox sits between the agent and every adapter: it offers only the tools the rules allow, says why each one is hidden, and checks every call. Switch a whole system off, or set one kind of action on it to follow the rules, ask a person first, or be blocked."
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
                  {tools.map(({ tool, visible, approval, reason }) => {
                    const siblings = tools
                      .filter((x) => x.tool !== tool && x.tool.action === tool.action)
                      .map((x) => x.tool.title);
                    return (
                      <li key={tool.name} className={visible ? "tool shown" : "tool hidden"}>
                        <div className="tool-row">
                          <span>
                            <strong>{tool.title}</strong> <code>{tool.name}</code>
                          </span>
                          <span
                            className={
                              !visible
                                ? "badge badge-stop"
                                : approval
                                  ? "badge badge-review"
                                  : "badge badge-permit"
                            }
                          >
                            {!visible ? "Hidden" : approval ? "Ask first" : "Offered"}
                          </span>
                        </div>
                        <p className="hint">{reason}</p>
                        {on && (
                          <ActionChoice
                            name={tool.name}
                            value={choiceOf(tool)}
                            onChange={(c) => choose(tool, c)}
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
            To try it with your own MCP client, run the same proxy from the solid-sdk repository:{" "}
            <code>{`pnpm --filter @jeswr/agent-sandbox... build && node packages/agent-sandbox/dist/mcp/cli.js --story ${CLI_STORY}`}</code>
            . Every decision is printed to the terminal as it happens.
          </p>
        </div>
      </Section>

      <Section
        title="The same rules as Claude Code settings"
        intro="The sandbox is the control that counts: it checks every call, whichever client makes it. The same choices can also be compiled into Claude Code's own settings, so Claude Code itself refuses the hidden tools, asks before the ones that need a person, and starts no other MCP servers. These files change as you change the choices above."
      >
        <div className="card">
          <h3>.mcp.json, in the solid-sdk checkout</h3>
          <pre className="log">{config.mcp}</pre>
          <h3>managed-settings.json, installed by IT on each machine</h3>
          <pre className="log">{config.managed}</pre>
        </div>
      </Section>
    </div>
  );
}
