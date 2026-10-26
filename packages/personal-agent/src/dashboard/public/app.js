// Agent dashboard (browser side). Plain ES module, no dependencies, served from this machine.
// Every value from the server is rendered as TEXT (DOM nodes and textContent) — never as HTML —
// so labels, notes and identifiers cannot inject markup or script. No inline handlers, no eval.

const state = {
  csrf: null,
  revision: null,
  connections: null,
  selected: null,
  adding: false,
  filters: { q: "", group: "all", status: "all", agent: "all" },
  cal: null,
};

// ------------------------------------------------------------------ DOM helpers

const SAFE_HREF = /^(#|\/(?!\/)|https:\/\/)/;

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (/^on/i.test(k) || k === "innerHTML" || k === "style") throw new Error(`refused prop ${k}`);
    if (k === "class") el.className = v;
    else if (k === "events") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "value" || k === "checked" || k === "selected" || k === "disabled") el[k] = v;
    else if (k === "href") {
      if (!SAFE_HREF.test(String(v))) throw new Error("refused link");
      el.setAttribute("href", String(v));
    } else el.setAttribute(k, v === true ? "" : String(v));
  }
  add(el, children);
  return el;
}

function add(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Append children, skipping null/undefined/false (never rendered as text). */
function put(el, ...children) {
  return add(el, children);
}

function clear(el) {
  el.replaceChildren();
  return el;
}

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function field(labelText, input, hint) {
  const id = input.id || nextId("f");
  input.id = id;
  const hintEl = hint ? h("span", { class: "hint", id: `${id}-hint` }, hint) : null;
  if (hintEl) input.setAttribute("aria-describedby", hintEl.id);
  return h("div", { class: "field" }, h("label", { for: id }, labelText), input, hintEl);
}

function check(labelText, input, hint) {
  const id = input.id || nextId("c");
  input.id = id;
  return h(
    "div",
    { class: "check" },
    input,
    h("label", { for: id }, labelText, hint ? h("span", { class: "hint" }, hint) : null),
  );
}

function facts(pairs) {
  const dl = h("dl", { class: "facts" });
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === "") continue;
    put(dl, h("dt", {}, k), h("dd", {}, v));
  }
  return dl;
}

function badge(text, kind) {
  return h("span", { class: `badge ${kind ?? ""}` }, text);
}

function message(kind, ...content) {
  return h(
    "div",
    { class: `message ${kind}`, ...(kind === "error" ? { role: "alert" } : {}) },
    ...content.map((c) => (typeof c === "string" ? h("p", {}, c) : c)),
  );
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d)
    : dateFmt.format(d);
}

/** A recorded time, labelled when it came from the synthetic demo clock (not the real time). */
function fmtRecorded(v, clock) {
  return clock === "synthetic-demo" ? `${fmtDate(v)} (demo clock, not the real time)` : fmtDate(v);
}

function fmtSlot(slot, tz) {
  try {
    const a = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const b = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${a.format(new Date(slot.start))}–${b.format(new Date(slot.end))}`;
  } catch {
    return `${slot.start} – ${slot.end}`;
  }
}

const humanise = (v) => String(v).replaceAll("_", " ");

// ------------------------------------------------------------------ API

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && state.csrf) headers["x-csrf-token"] = state.csrf;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error(data?.error ?? `The request failed (${res.status}).`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

// ------------------------------------------------------------------ notices

const noticeEl = () => document.getElementById("notice");
let noticeTimer;

function notify(kind, text) {
  clearTimeout(noticeTimer);
  put(clear(noticeEl()), message(kind, text));
  if (kind === "ok") noticeTimer = setTimeout(() => clear(noticeEl()), 8000);
}

function errorContent(error, retry) {
  const parts = [error.message];
  const issues = error.data?.issues;
  const list = Array.isArray(issues)
    ? h(
        "ul",
        { class: "plain" },
        issues.map((i) => h("li", {}, i.path ? `${i.path}: ${i.message}` : i.message)),
      )
    : null;
  const actions = h("div", { class: "actions" });
  if (error.status === 409 || retry)
    put(
      actions,
      h(
        "button",
        { type: "button", events: { click: () => (retry ? retry() : route()) } },
        error.status === 409 ? "Reload the latest settings" : "Try again",
      ),
    );
  return message(
    "error",
    error.status === 409 ? `These settings were changed elsewhere. ${parts[0]}` : parts[0],
    list,
    actions.childElementCount ? actions : null,
  );
}

function showError(error) {
  clearTimeout(noticeTimer);
  put(clear(noticeEl()), errorContent(error));
}

async function busy(button, fn) {
  button.disabled = true;
  const label = button.textContent;
  button.textContent = `${label}…`;
  try {
    return await fn();
  } catch (error) {
    showError(error);
    if (error.status === 401) signedOut(error.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ------------------------------------------------------------------ routing

const VIEWS = {
  overview: { title: "Overview", render: viewOverview },
  connections: { title: "Connections", render: viewConnections },
  calendars: { title: "Calendars", render: viewCalendars },
  permissions: { title: "Permissions", render: viewPermissions },
  triage: { title: "Message triage", render: viewTriage },
  actions: { title: "Actions", render: viewActions },
};

let firstRoute = true;
async function route() {
  const name = location.hash.replace(/^#/, "") || "overview";
  const view = VIEWS[name] ?? VIEWS.overview;
  for (const a of document.querySelectorAll(".site-nav a"))
    if (a.dataset.view === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  document.title = `${view.title} · Agent dashboard`;
  const root = document.getElementById("view");
  root.setAttribute("aria-busy", "true");
  put(clear(root), h("p", { class: "loading" }, `Loading ${view.title.toLowerCase()}…`));
  clear(noticeEl());
  try {
    const frag = document.createDocumentFragment();
    await view.render(frag);
    put(clear(root), frag);
  } catch (error) {
    if (error.status === 401) return signedOut(error.message);
    put(clear(root), h("h1", { tabindex: "-1" }, view.title), errorContent(error, route));
  } finally {
    root.setAttribute("aria-busy", "false");
  }
  if (!firstRoute) root.querySelector("h1")?.focus();
  firstRoute = false;
}

function signedOut(text) {
  const root = document.getElementById("view");
  root.setAttribute("aria-busy", "false");
  clear(noticeEl());
  put(
    clear(root),
    h("h1", { tabindex: "-1" }, "Sign in"),
    message(
      "warn",
      text ?? "Not signed in.",
      "The dashboard prints a one-time sign-in link in the terminal where it runs. Press Enter there for a new link, then open it in this browser.",
    ),
  );
}

async function start() {
  const m = /^#code=([A-Za-z0-9_-]{16,128})$/.exec(location.hash);
  if (m) {
    // Remove the one-time code from the address bar and history before using it.
    history.replaceState(null, "", "/#overview");
    try {
      state.csrf = (await api("POST", "/session", { code: m[1] })).csrf;
    } catch (error) {
      return signedOut(error.message);
    }
  } else {
    try {
      state.csrf = (await api("GET", "/session")).csrf;
    } catch (error) {
      return signedOut(error.status === 401 ? error.message : "The dashboard is not reachable.");
    }
  }
  window.addEventListener("hashchange", route);
  await route();
}

// ------------------------------------------------------------------ Overview

const STATE_BADGE = {
  "active-provider": "ok",
  "local-connector": "info",
  "previously-codex": "warn",
  inventory: "",
  "setup-required": "warn",
  unknown: "bad",
};

async function viewOverview(root) {
  const [o, hist] = await Promise.all([api("GET", "/overview"), api("GET", "/history")]);
  state.revision = o.revision;
  const byState = h("ul", { class: "plain" });
  for (const [k, n] of Object.entries(o.connections.byState))
    put(byState, h("li", {}, badge(o.states[k]?.title ?? k, STATE_BADGE[k]), ` ${n}`));
  put(
    root,
    h("h1", { tabindex: "-1" }, "Overview"),
    h(
      "p",
      { class: "lede" },
      "What this agent knows about your accounts, calendars and triage, and where each fact comes from. Settings revision ",
      String(o.revision),
      ".",
    ),
  );
  const grid = h("div", { class: "grid" });
  put(
    grid,
    h(
      "section",
      { class: "panel", "aria-labelledby": "ov-acc" },
      h("h2", { id: "ov-acc" }, "Accounts"),
      h("p", { class: "stat" }, String(o.connections.total)),
      o.connections.total === 0
        ? h(
            "p",
            { class: "empty" },
            "No accounts yet. Import your inventory from a terminal (see the dashboard guide) or add a record.",
          )
        : [
            byState,
            h(
              "p",
              { class: "small muted" },
              `${o.connections.enabled} included for the agent · ${o.connections.stale} with stale or no evidence`,
            ),
          ],
      h(
        "p",
        { class: "small" },
        o.inventory
          ? `Inventory snapshot from ${fmtDate(o.inventory.observedAt)} (registry updated ${o.inventory.registryUpdated}). These are records, not live checks.`
          : "No inventory imported.",
      ),
      h("a", { href: "#connections" }, "Review connections"),
    ),
    h(
      "section",
      { class: "panel", "aria-labelledby": "ov-cal" },
      h("h2", { id: "ov-cal" }, "Calendars"),
      h(
        "p",
        {},
        o.calendars.status === "ready" ? badge("Ready", "ok") : badge("Blocked", "bad"),
        ` ${o.calendars.total} calendars`,
      ),
      o.calendars.reasons.length
        ? h(
            "ul",
            { class: "plain small" },
            o.calendars.reasons.map((r) => h("li", {}, r)),
          )
        : h(
            "p",
            { class: "small muted" },
            "Availability can be computed from your chosen calendars.",
          ),
      h("a", { href: "#calendars" }, "Review calendars"),
    ),
    h(
      "section",
      { class: "panel", "aria-labelledby": "ov-agents" },
      h("h2", { id: "ov-agents" }, "Agents"),
      o.agents.length === 0
        ? h("p", { class: "empty" }, "No agent is managed by this dashboard yet.")
        : h(
            "ul",
            { class: "plain" },
            o.agents.map((a) =>
              h(
                "li",
                {},
                h("strong", {}, a.name),
                " ",
                !a.found
                  ? badge("Not found", "bad")
                  : a.running
                    ? badge("Running", "info")
                    : badge("Stopped", ""),
                h(
                  "div",
                  { class: "small muted" },
                  !a.availability.applied
                    ? "Calendar settings not applied yet."
                    : useText(a.availability),
                ),
              ),
            ),
          ),
      h("a", { href: "#permissions" }, "Review agent permissions"),
    ),
    h(
      "section",
      { class: "panel", "aria-labelledby": "ov-triage" },
      h("h2", { id: "ov-triage" }, "Message triage"),
      h("p", {}, "Local rules: always available."),
      h(
        "p",
        {},
        "Hosted (TypeSafe): ",
        o.triage.hostedConfigured
          ? o.triage.hostedEnabled
            ? badge("On", "info")
            : badge("Off", "")
          : badge("Not set up", ""),
      ),
      h("a", { href: "#triage" }, "Open message triage"),
    ),
  );
  put(root, grid);

  const table = h(
    "table",
    {},
    h("caption", {}, "Change history (most recent first)"),
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        ["Revision", "When", "By", "Change", "Details"].map((t) => h("th", { scope: "col" }, t)),
      ),
    ),
    h(
      "tbody",
      {},
      hist.history.map((e) =>
        h(
          "tr",
          {},
          h("td", {}, String(e.revision)),
          h("td", {}, fmtRecorded(e.at, e.clock)),
          h("td", {}, e.actor),
          h("td", {}, e.action),
          h("td", {}, e.summary),
        ),
      ),
    ),
  );
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "ov-hist" },
      h("h2", { id: "ov-hist" }, "History"),
      hist.history.length === 0
        ? h("p", { class: "empty" }, "No changes yet.")
        : h("div", { class: "table-wrap" }, table),
    ),
  );
}

// ------------------------------------------------------------------ Connections

const CHANNELS = [
  "email",
  "calendar",
  "slack",
  "whatsapp",
  "signal",
  "matrix",
  "microsoft_teams",
  "discord",
  "phone_messages",
  "github_notifications",
  "other",
];

async function loadConnections() {
  const d = await api("GET", "/connections");
  state.revision = d.revision;
  state.connections = d;
  return d;
}

function matches(c) {
  const f = state.filters;
  if (f.group !== "all" && c.group !== f.group) return false;
  if (f.status !== "all" && c.status.state !== f.status) return false;
  if (f.agent === "enabled" && !c.restrictions.agentEnabled) return false;
  if (f.agent === "excluded" && c.restrictions.agentEnabled) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return [c.label, c.channel, c.provider, c.organisation, ...c.identifiers, c.notes]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

async function viewConnections(root) {
  const d = await loadConnections();
  put(
    root,
    h("h1", { tabindex: "-1" }, "Connections"),
    h(
      "p",
      { class: "lede" },
      "Accounts known to this agent and where each status comes from. A listed account is not a connection, and a connection is not permission.",
    ),
  );
  if (d.inventory)
    put(
      root,
      message(
        "",
        `Imported from an inventory snapshot taken ${fmtDate(d.inventory.observedAt)} (registry updated ${d.inventory.registryUpdated}). Statuses describe that record and earlier evidence, not a live check.`,
      ),
    );
  if (d.inventory?.notes.length)
    put(
      root,
      h(
        "details",
        { class: "panel" },
        h("summary", {}, `Inventory notes (${d.inventory.notes.length})`),
        h(
          "p",
          { class: "small muted" },
          "As written in the inventory, for reference. Notes never count as evidence: only structured evidence records are attached, and only to accounts of the same channel with that exact identifier.",
        ),
        h(
          "ul",
          { class: "plain" },
          d.inventory.notes.map((n) => h("li", {}, n)),
        ),
      ),
    );
  const unmatched = d.inventory?.unmatchedEvidence ?? [];
  if (unmatched.length)
    put(
      root,
      h(
        "details",
        { class: "panel" },
        h("summary", {}, `Historic observations matching no account (${unmatched.length})`),
        h(
          "p",
          { class: "small muted" },
          "Structured evidence records whose exact identifier no account of that channel lists. They are kept unresolved and not attached to a similar-looking account.",
        ),
        h(
          "ul",
          { class: "plain" },
          unmatched.map((e) =>
            h(
              "li",
              {},
              `${fmtDate(e.observedOn)}: `,
              h("span", { class: "mono" }, e.identifier),
              ` (${humanise(e.channel)}, ${humanise(e.method)} through a ${humanise(e.provider)} connector)`,
            ),
          ),
        ),
      ),
    );
  const legend = h("dl", { class: "facts" });
  for (const [k, v] of Object.entries(d.states))
    put(legend, h("dt", {}, badge(v.title, STATE_BADGE[k])), h("dd", {}, v.meaning));
  put(root, h("details", { class: "panel" }, h("summary", {}, "What the statuses mean"), legend));

  const list = h("ul", { class: "accounts", id: "account-list" });
  const count = h("p", { class: "small muted", role: "status", "aria-live": "polite" });
  const detail = h("aside", {
    class: "panel detail",
    id: "detail",
    "aria-label": "Account details",
  });

  const renderList = () => {
    clear(list);
    const shown = d.connections.filter(matches);
    count.textContent = `${shown.length} of ${d.connections.length} accounts`;
    if (d.connections.length === 0)
      put(
        list,
        h(
          "li",
          { class: "empty" },
          "No accounts yet. Import your inventory from a terminal, or add a record.",
        ),
      );
    else if (shown.length === 0)
      put(list, h("li", { class: "empty" }, "No account matches these filters."));
    for (const c of shown) {
      const row = h(
        "button",
        {
          type: "button",
          class: "account-row",
          "aria-pressed": String(state.selected === c.id),
          "aria-controls": "detail",
          events: {
            click: () => {
              state.selected = c.id;
              state.adding = false;
              renderList();
              renderDetail(detail, d, renderAll);
              detail.querySelector("h2")?.focus();
            },
          },
        },
        h("span", { class: "name" }, c.label),
        h(
          "span",
          { class: "meta" },
          [humanise(c.channel), c.provider ? humanise(c.provider) : null, c.organisation || null]
            .filter(Boolean)
            .join(" · "),
        ),
        h(
          "span",
          { class: "badges" },
          badge(c.status.title, STATE_BADGE[c.status.state]),
          c.restrictions.agentEnabled ? badge("Included", "info") : badge("Excluded", ""),
          c.status.stale ? badge("Stale", "warn") : null,
        ),
      );
      put(list, h("li", {}, row));
    }
  };
  const renderAll = async (selectId) => {
    const fresh = await loadConnections();
    Object.assign(d, fresh);
    if (selectId !== undefined) state.selected = selectId;
    renderList();
    renderDetail(detail, d, renderAll);
  };

  const search = h("input", {
    type: "search",
    value: state.filters.q,
    autocomplete: "off",
    events: {
      input: (e) => {
        state.filters.q = e.target.value;
        renderList();
      },
    },
  });
  const select = (key, options) =>
    h(
      "select",
      {
        events: {
          change: (e) => {
            state.filters[key] = e.target.value;
            renderList();
          },
        },
      },
      options.map(([v, t]) => h("option", { value: v, selected: state.filters[key] === v }, t)),
    );
  const filters = h(
    "search",
    {},
    h(
      "form",
      { class: "row", events: { submit: (e) => e.preventDefault() } },
      field("Search accounts", search),
      field(
        "Kind",
        select("group", [
          ["all", "All kinds"],
          ["email", "Email"],
          ["chat", "Chat"],
          ["calendar", "Calendar"],
          ["other", "Other"],
        ]),
      ),
      field(
        "Status",
        select("status", [
          ["all", "All statuses"],
          ...Object.entries(d.states).map(([k, v]) => [k, v.title]),
        ]),
      ),
      field(
        "Agent use",
        select("agent", [
          ["all", "Included and excluded"],
          ["enabled", "Included"],
          ["excluded", "Excluded"],
        ]),
      ),
    ),
  );
  const addButton = h(
    "button",
    {
      type: "button",
      events: {
        click: () => {
          state.adding = true;
          state.selected = null;
          renderList();
          renderDetail(detail, d, renderAll);
          detail.querySelector("h2")?.focus();
        },
      },
    },
    "Add an account record",
  );
  put(
    root,
    h(
      "div",
      { class: "split" },
      h(
        "section",
        { class: "panel", "aria-labelledby": "acc-h" },
        h("h2", { id: "acc-h" }, "Accounts"),
        filters,
        h("div", { class: "row" }, count, addButton),
        list,
      ),
      detail,
    ),
  );
  renderList();
  renderDetail(detail, d, renderAll);
}

function restrictionInputs(r) {
  const box = (key, checked) => h("input", { type: "checkbox", name: key, checked });
  const inputs = {
    agentEnabled: box("agentEnabled", r.agentEnabled),
    read: box("read", r.read),
    triage: box("triage", r.triage),
    draft: box("draft", r.draft),
    hostedTriage: box("hostedTriage", r.hostedTriage),
  };
  const sync = () => {
    for (const k of ["read", "triage", "draft", "hostedTriage"])
      inputs[k].disabled = !inputs.agentEnabled.checked;
  };
  inputs.agentEnabled.addEventListener("change", sync);
  sync();
  const fieldset = h(
    "fieldset",
    {},
    h("legend", {}, "What the agent may do with this account"),
    check(
      "Include this account for the agent",
      inputs.agentEnabled,
      "Off excludes it locally. This does not revoke anything at the provider.",
    ),
    check("Read messages", inputs.read),
    check("Suggest triage", inputs.triage, "Needs reading as well."),
    check(
      "Draft replies for your review (future)",
      inputs.draft,
      "This version cannot draft; the choice is recorded for later. Sending is never enabled here.",
    ),
    check(
      "Allow samples to be sent to hosted triage (TypeSafe)",
      inputs.hostedTriage,
      "Needs reading and triage too. Only for samples you confirm one by one, and only when hosted triage is on.",
    ),
    h(
      "p",
      { class: "small muted" },
      "These are your restrictions only. The agent also needs a working provider connection, and your policy must allow the action. See Permissions.",
    ),
  );
  return {
    fieldset,
    value: () =>
      Object.fromEntries(
        Object.entries(inputs).map(([k, el]) => [
          k,
          el.checked && (k === "agentEnabled" || inputs.agentEnabled.checked),
        ]),
      ),
  };
}

function describedFields(c) {
  const label = h("input", { type: "text", required: true, maxlength: 120, value: c?.label ?? "" });
  const channel = h(
    "select",
    {},
    CHANNELS.map((ch) =>
      h("option", { value: ch, selected: (c?.channel ?? "email") === ch }, humanise(ch)),
    ),
  );
  if (c && !CHANNELS.includes(c.channel))
    put(channel, h("option", { value: c.channel, selected: true }, humanise(c.channel)));
  const provider = h("input", { type: "text", maxlength: 60, value: c?.provider ?? "" });
  const organisation = h("input", { type: "text", maxlength: 120, value: c?.organisation ?? "" });
  const identifiers = h("textarea", { rows: 3, maxlength: 2100 }, c?.identifiers.join("\n") ?? "");
  return {
    nodes: [
      field("Name", label),
      h(
        "div",
        { class: "row" },
        field("Kind", channel),
        field("Provider", provider, "For example gmail, microsoft_365."),
      ),
      field("Organisation", organisation),
      field(
        "Identifiers",
        identifiers,
        "Addresses or handles, one per line. Stored privately on this machine.",
      ),
    ],
    value: () => ({
      label: label.value.trim(),
      channel: channel.value,
      provider: provider.value.trim(),
      organisation: organisation.value.trim(),
      identifiers: identifiers.value
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 10),
    }),
  };
}

function renderDetail(detail, d, refresh) {
  clear(detail);
  if (state.adding) return renderAdd(detail, refresh);
  const c = d.connections.find((x) => x.id === state.selected);
  if (!c) {
    put(
      detail,
      h("h2", { tabindex: "-1" }, "Account details"),
      h(
        "p",
        { class: "empty" },
        "Choose an account to see its status, evidence, setup steps and your restrictions.",
      ),
    );
    return;
  }
  put(
    detail,
    h("h2", { tabindex: "-1" }, c.label),
    h(
      "p",
      {},
      badge(c.status.title, STATE_BADGE[c.status.state]),
      c.status.stale ? [" ", badge("Stale", "warn")] : null,
    ),
    h("p", {}, c.status.explanation),
    facts([
      ["Kind", humanise(c.channel)],
      ["Provider", c.provider ? humanise(c.provider) : "Not recorded"],
      ["Organisation", c.organisation || "Not recorded"],
      [
        "Identifiers",
        c.identifiers.length
          ? h(
              "ul",
              { class: "plain" },
              c.identifiers.map((i) => h("li", { class: "mono" }, i)),
            )
          : "None recorded",
      ],
      ["Status source", c.status.source],
      ["Last observed", c.status.lastObserved ? fmtDate(c.status.lastObserved) : "Never"],
      ["In this agent", c.status.adapter],
      [
        "Record",
        c.origin === "inventory"
          ? "Imported from your inventory"
          : c.origin === "demo"
            ? "Synthetic demo record"
            : "Added by you",
      ],
      ["Last changed", `${fmtRecorded(c.updatedAt, c.updatedAtClock)} by ${c.updatedBy}`],
    ]),
  );
  if (c.evidence.length)
    put(
      detail,
      h("h3", {}, "Earlier evidence"),
      h(
        "ul",
        { class: "plain" },
        c.evidence.map((e) =>
          h(
            "li",
            {},
            `${fmtDate(e.observedOn)}: `,
            e.identifier ? h("span", { class: "mono" }, e.identifier) : null,
            e.identifier ? ". " : null,
            e.summary,
          ),
        ),
      ),
    );
  if (c.conflicts.length)
    put(
      detail,
      h("h3", {}, "Unresolved conflicts"),
      message(
        "warn",
        h(
          "ul",
          { class: "plain" },
          c.conflicts.map((x) => h("li", {}, x)),
        ),
        "These are kept as they are until you resolve them in your inventory.",
      ),
    );
  if (c.inventory)
    put(
      detail,
      h(
        "details",
        {},
        h("summary", {}, "Inventory record"),
        facts([
          ["Intended connector", humanise(c.inventory.connectorTarget)],
          ["Setup status", humanise(c.inventory.setupStatus)],
          ["Last tested", c.inventory.lastTested ? fmtDate(c.inventory.lastTested) : undefined],
          [
            "Test result",
            c.inventory.lastTestResult ? humanise(c.inventory.lastTestResult) : undefined,
          ],
          [
            "Listed as available in tools",
            c.inventory.availableInMcp === undefined
              ? undefined
              : c.inventory.availableInMcp
                ? "Yes"
                : "No",
          ],
          ["Snapshot taken", fmtDate(c.inventory.observedAt)],
        ]),
      ),
    );

  const restrictions = restrictionInputs(c.restrictions);
  const notes = h("textarea", { rows: 3, maxlength: 1000 }, c.notes);
  const target = h("input", { type: "text", maxlength: 80, value: c.localConnector.target ?? "" });
  const described = c.origin === "inventory" ? null : describedFields(c);
  const save = h("button", { type: "submit", class: "primary" }, "Save changes");
  const form = h(
    "form",
    {
      events: {
        submit: (e) => {
          e.preventDefault();
          busy(save, async () => {
            const r = await api("PUT", `/connections/${encodeURIComponent(c.id)}`, {
              baseRevision: state.revision,
              changes: {
                restrictions: restrictions.value(),
                notes: notes.value,
                target: target.value.trim(),
                ...(described ? described.value() : {}),
              },
            });
            await refresh(c.id);
            notify("ok", `Saved “${r.connection.label}”. Settings revision ${r.revision}.`);
          });
        },
      },
    },
    h("h3", {}, "Your settings"),
    restrictions.fieldset,
    described ? h("fieldset", {}, h("legend", {}, "Record"), described.nodes) : null,
    field(
      "Planned connector",
      target,
      "A note on how this account should be connected. It connects nothing.",
    ),
    field("Notes", notes),
    h("div", { class: "actions" }, save),
  );
  put(detail, form);
  if (c.origin !== "inventory") {
    const remove = h("button", { type: "button", class: "danger" }, "Remove this record");
    remove.addEventListener("click", () =>
      busy(remove, async () => {
        if (
          !window.confirm(
            `Remove “${c.label}” from this dashboard? This does not affect the provider.`,
          )
        )
          return;
        const r = await api("DELETE", `/connections/${encodeURIComponent(c.id)}`, {
          baseRevision: state.revision,
        });
        await refresh(null);
        notify("ok", `Removed the record. Settings revision ${r.revision}.`);
      }),
    );
    put(detail, h("div", { class: "actions" }, remove));
  }
  put(
    detail,
    h("h3", {}, "Setting this account up"),
    h("p", {}, c.setup.summary),
    h(
      "ol",
      { class: "plain" },
      c.setup.steps.map((s) => h("li", {}, s)),
    ),
    h("h3", {}, "Excluding versus revoking"),
    h("p", {}, c.setup.disconnect),
  );
}

function renderAdd(detail, refresh) {
  const described = describedFields(null);
  const notes = h("textarea", { rows: 3, maxlength: 1000 });
  const target = h("input", { type: "text", maxlength: 80 });
  const save = h("button", { type: "submit", class: "primary" }, "Add record");
  const cancel = h("button", { type: "button" }, "Cancel");
  cancel.addEventListener("click", () => {
    state.adding = false;
    refresh(null);
  });
  put(
    detail,
    h("h2", { tabindex: "-1" }, "Add an account record"),
    h(
      "p",
      {},
      "A record describes an account so the agent can be set up for it later. It starts as “setup required”, with everything turned off. Nothing is connected or signed in.",
    ),
    h(
      "form",
      {
        events: {
          submit: (e) => {
            e.preventDefault();
            busy(save, async () => {
              const r = await api("POST", "/connections", {
                baseRevision: state.revision,
                record: {
                  ...described.value(),
                  notes: notes.value,
                  ...(target.value.trim() ? { target: target.value.trim() } : {}),
                },
              });
              state.adding = false;
              await refresh(r.id);
              notify("ok", `Added the record. Settings revision ${r.revision}.`);
            });
          },
        },
      },
      described.nodes,
      field("Planned connector", target, "Optional note, for example “gmail adapter”."),
      field("Notes", notes),
      h("div", { class: "actions" }, save, cancel),
    ),
  );
}

// ------------------------------------------------------------------ Calendars

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function randomSuffix() {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function calId(label) {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "calendar"}-${randomSuffix()}`;
}

async function viewCalendars(root) {
  const d = await api("GET", "/calendars");
  state.revision = d.revision;
  state.cal = {
    saved: d,
    calendars: structuredClone(d.calendars),
    availability: structuredClone(d.availability),
    dirty: false,
  };
  put(
    root,
    h("h1", { tabindex: "-1" }, "Calendars"),
    h(
      "p",
      { class: "lede" },
      "Choose which calendars count for availability, where synthetic holds are written, and your working hours. Only synthetic calendars can be read in this version. Provider calendars are records until they are set up.",
    ),
  );
  const statusBox = h("section", { class: "panel", "aria-labelledby": "cal-status" });
  const formBox = h("div");
  const previewBox = h("section", { class: "panel", "aria-labelledby": "cal-prev" });
  put(root, statusBox, formBox, previewBox);
  const rerender = () => {
    renderCalStatus(statusBox);
    renderCalForm(formBox, rerender);
  };
  rerender();
  renderPreview(previewBox);
}

function renderCalStatus(box) {
  const { saved, dirty } = state.cal;
  const ev = saved.evaluation;
  put(
    clear(box),
    h("h2", { id: "cal-status" }, "Saved settings"),
    h(
      "p",
      {},
      ev.status === "ready" ? badge("Ready", "ok") : badge("Blocked", "bad"),
      " ",
      ev.status === "ready"
        ? "Availability can be computed from the calendars you chose."
        : "The agent will not offer or accept any time until this is fixed:",
    ),
    ev.reasons.length
      ? h(
          "ul",
          { class: "plain" },
          ev.reasons.map((r) => h("li", {}, r)),
        )
      : null,
    dirty ? message("warn", "You have unsaved changes below. Save them before applying.") : null,
    h("h3", {}, "Apply to the agent"),
    h(
      "p",
      { class: "small" },
      "The agent reads these settings when it starts. Applying writes them for the agent; a running agent uses them from its next start. If the settings are blocked, the applied file blocks scheduling too.",
    ),
  );
  if (saved.managedAgents.length === 0)
    put(
      box,
      h(
        "p",
        { class: "empty" },
        "No agent is managed by this dashboard. Run the demo setup to create one.",
      ),
    );
  for (const a of saved.managedAgents) {
    const apply = h(
      "button",
      { type: "button", disabled: dirty || !a.found },
      `Apply to ${a.name}`,
    );
    apply.addEventListener("click", () =>
      busy(apply, async () => {
        const r = await api("POST", "/calendars/apply", {
          baseRevision: state.revision,
          agent: a.name,
        });
        await route();
        notify(
          "ok",
          `Applied revision ${r.applied.revision} to ${r.agent}${r.applied.blocked ? " (blocked: no time will be offered)" : ""}. ${r.takesEffect}`,
        );
      }),
    );
    put(
      box,
      h(
        "div",
        { class: "row" },
        h(
          "p",
          {},
          h("strong", {}, a.name),
          " ",
          !a.found
            ? badge("Not found", "bad")
            : a.running
              ? badge("Running", "info")
              : badge("Stopped", ""),
          " ",
          a.matchesSaved === null
            ? badge("Not applied", "warn")
            : a.matchesSaved
              ? badge("Applied file matches saved settings", "ok")
              : badge("Applied file differs from saved settings", "warn"),
          a.holds.length ? ` · ${a.holds.length} synthetic holds` : "",
        ),
        apply,
      ),
      a.availability.applied ? h("p", { class: "small muted" }, useText(a.availability)) : null,
    );
  }
}

/** What the RUNNING agent uses (it reads availability only when it starts). */
function useText(av) {
  const blocked = av.blocked ? " These settings block scheduling." : "";
  switch (av.use) {
    case "in-use":
      return `The running agent started after the last apply, so it uses these settings.${blocked}`;
    case "pending-restart":
      return `The agent has been running since before the last apply: it still uses the settings it started with. Restart it to use these.${blocked}`;
    case "unknown":
      return `The agent is running; when it started is unknown, so it may still use older settings.${blocked}`;
    default:
      return `The agent uses these settings from its next start.${blocked}`;
  }
}

function markDirty() {
  if (state.cal.dirty) return;
  state.cal.dirty = true;
  renderCalStatus(document.querySelector('[aria-labelledby="cal-status"]'));
}

function renderCalForm(box, rerender) {
  const cal = state.cal;
  const av = cal.availability;
  const byId = new Map(cal.saved.evaluation.sources.map((s) => [s.id, s]));
  const rows = cal.calendars.map((c) => {
    const view = byId.get(c.id);
    const cb = (checked, label, onChange) =>
      h("input", {
        type: "checkbox",
        checked,
        "aria-label": `${label}: ${c.label}`,
        events: {
          change: (e) => {
            onChange(e.target.checked);
            markDirty();
          },
        },
      });
    const busyList = h("div");
    if (c.kind === "local-synthetic") put(busyList, busyEditor(c, rerender));
    const remove = h("button", { type: "button", class: "danger" }, "Remove");
    remove.setAttribute("aria-label", `Remove ${c.label}`);
    remove.addEventListener("click", () => {
      cal.calendars = cal.calendars.filter((x) => x.id !== c.id);
      av.authoritative = av.authoritative.filter((x) => x !== c.id);
      if (av.bookingTarget === c.id) av.bookingTarget = null;
      cal.dirty = true;
      rerender();
    });
    return h(
      "tr",
      {},
      h(
        "th",
        { scope: "row" },
        c.label,
        h(
          "div",
          { class: "small muted" },
          cal.saved.kinds[c.kind] ?? c.kind,
          c.provider ? ` · ${humanise(c.provider)}` : "",
        ),
        view
          ? h(
              "div",
              { class: "small" },
              view.state === "available"
                ? badge("Available", "ok")
                : view.state === "disabled"
                  ? badge("Off", "")
                  : badge("Unavailable", "bad"),
              " ",
              view.explanation,
            )
          : h("div", { class: "small muted" }, "New: save to check it."),
        busyList,
      ),
      h(
        "td",
        {},
        cb(c.enabled, "On", (v) => (c.enabled = v)),
      ),
      h(
        "td",
        {},
        cb(
          c.permissions.readAvailability,
          "May read availability",
          (v) => (c.permissions.readAvailability = v),
        ),
      ),
      h(
        "td",
        {},
        cb(
          c.permissions.createBookings,
          "May receive bookings",
          (v) => (c.permissions.createBookings = v),
        ),
      ),
      h(
        "td",
        {},
        cb(av.authoritative.includes(c.id), "Counts for availability", (v) => {
          av.authoritative = v
            ? [...av.authoritative, c.id]
            : av.authoritative.filter((x) => x !== c.id);
        }),
      ),
      h(
        "td",
        {},
        h("input", {
          type: "radio",
          name: "booking-target",
          checked: av.bookingTarget === c.id,
          "aria-label": `Booking calendar: ${c.label}`,
          events: {
            change: () => {
              av.bookingTarget = c.id;
              markDirty();
            },
          },
        }),
      ),
      h("td", {}, remove),
    );
  });
  const noTarget = h("input", {
    type: "radio",
    name: "booking-target",
    checked: av.bookingTarget === null,
    events: {
      change: () => {
        av.bookingTarget = null;
        markDirty();
      },
    },
  });
  const table = h(
    "table",
    {},
    h("caption", {}, "Calendar sources"),
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        [
          "Calendar",
          "On",
          "May read availability",
          "May receive bookings",
          "Counts for availability",
          "Booking calendar",
          "",
        ].map((t) => h("th", { scope: "col" }, t)),
      ),
    ),
    h(
      "tbody",
      {},
      rows.length
        ? rows
        : h("tr", {}, h("td", { colspan: 7, class: "empty" }, "No calendars yet.")),
    ),
  );

  // Add a calendar
  const newLabel = h("input", { type: "text", maxlength: 120 });
  const newKind = h(
    "select",
    {},
    h("option", { value: "local-synthetic" }, cal.saved.kinds["local-synthetic"]),
    h("option", { value: "external" }, `${cal.saved.kinds.external} (setup required)`),
    cal.saved.managedAgents
      .filter((a) => !cal.calendars.some((c) => c.kind === "agent-synthetic" && c.agent === a.name))
      .map((a) =>
        h(
          "option",
          { value: `agent:${a.name}` },
          `${cal.saved.kinds["agent-synthetic"]} (${a.name})`,
        ),
      ),
  );
  const newProvider = h("input", { type: "text", maxlength: 60 });
  const newProviderCalendarId = h("input", { type: "text", maxlength: 300, autocomplete: "off" });
  const newAccount = h(
    "select",
    {},
    h("option", { value: "" }, "No account"),
    cal.saved.accounts.map((a) => h("option", { value: a.id }, a.label)),
  );
  const addBtn = h("button", { type: "button" }, "Add calendar");
  addBtn.addEventListener("click", () => {
    const label = newLabel.value.trim();
    if (!label) {
      notify("error", "Give the calendar a name first.");
      newLabel.focus();
      return;
    }
    const kind = newKind.value.startsWith("agent:") ? "agent-synthetic" : newKind.value;
    cal.calendars.push({
      id: calId(label),
      label,
      kind,
      ...(kind === "external" && newProvider.value.trim()
        ? { provider: newProvider.value.trim() }
        : {}),
      ...(kind === "agent-synthetic" ? { agent: newKind.value.slice(6) } : {}),
      ...(kind === "external" && newAccount.value ? { connectionId: newAccount.value } : {}),
      ...(kind === "external" && newProviderCalendarId.value.trim()
        ? { providerCalendarId: newProviderCalendarId.value.trim() }
        : {}),
      busy: [],
      enabled: kind !== "external",
      permissions: { readAvailability: kind !== "external", createBookings: false },
    });
    cal.dirty = true;
    rerender();
  });

  // Time zone and working hours
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const tz = h("input", {
    type: "text",
    list: "tz-list",
    value: av.timeZone,
    maxlength: 64,
    autocomplete: "off",
  });
  tz.addEventListener("change", () => {
    av.timeZone = tz.value.trim();
    markDirty();
  });
  const startT = h("input", { type: "time", value: av.workingHours.start });
  const endT = h("input", { type: "time", value: av.workingHours.end });
  startT.addEventListener("change", () => {
    av.workingHours.start = startT.value;
    markDirty();
  });
  endT.addEventListener("change", () => {
    av.workingHours.end = endT.value;
    markDirty();
  });
  const days = h(
    "fieldset",
    {},
    h("legend", {}, "Working days"),
    h(
      "div",
      { class: "row" },
      DAYS.map((name, i) => {
        const input = h("input", {
          type: "checkbox",
          checked: av.workingHours.days.includes(i + 1),
          events: {
            change: (e) => {
              const set = new Set(av.workingHours.days);
              if (e.target.checked) set.add(i + 1);
              else set.delete(i + 1);
              av.workingHours.days = [...set].sort();
              markDirty();
            },
          },
        });
        return check(name, input);
      }),
    ),
  );

  const save = h("button", { type: "submit", class: "primary" }, "Save calendar settings");
  const discard = h("button", { type: "button" }, "Discard changes");
  discard.addEventListener("click", () => route());
  put(
    clear(box),
    h(
      "form",
      {
        class: "panel",
        "aria-labelledby": "cal-edit",
        events: {
          submit: (e) => {
            e.preventDefault();
            busy(save, async () => {
              const r = await api("PUT", "/calendars", {
                baseRevision: state.revision,
                calendars: cal.calendars,
                availability: cal.availability,
              });
              await route();
              notify(
                "ok",
                `Saved (revision ${r.revision}). ${r.evaluation.status === "ready" ? "Availability is ready." : "Availability is blocked; see the reasons above."} Apply it to the agent to use it.`,
              );
            });
          },
        },
      },
      h("h2", { id: "cal-edit" }, "Edit calendars"),
      h(
        "p",
        { class: "small muted" },
        "Reading availability and receiving bookings are separate permissions. Every calendar that counts for availability must be readable and available, or scheduling is blocked. Only the agent's own synthetic calendar can receive holds; synthetic holds are not real bookings.",
      ),
      h("div", { class: "table-wrap" }, table),
      check("No booking calendar (blocks scheduling)", noTarget),
      h(
        "fieldset",
        {},
        h("legend", {}, "Add a calendar"),
        h(
          "div",
          { class: "row" },
          field("Name", newLabel),
          field("Kind", newKind),
          field("Provider (provider calendars)", newProvider),
          field("Account (provider calendars)", newAccount),
          field(
            "Provider calendar ID",
            newProviderCalendarId,
            'Google calendar ID or Microsoft calendar id; "primary" for the default calendar.',
          ),
          addBtn,
        ),
      ),
      h(
        "fieldset",
        {},
        h("legend", {}, "Time zone and working hours"),
        h(
          "div",
          { class: "row" },
          field("Time zone", tz, "IANA name, for example Europe/London."),
          field("Start", startT),
          field("End", endT),
        ),
        h(
          "datalist",
          { id: "tz-list" },
          zones.map((z) => h("option", { value: z })),
        ),
        days,
      ),
      h("div", { class: "actions" }, save, discard),
    ),
  );
}

function busyEditor(c, rerender) {
  const start = h("input", { type: "datetime-local", step: 900 });
  const end = h("input", { type: "datetime-local", step: 900 });
  const addBtn = h("button", { type: "button" }, "Add busy period");
  const toIso = (v) => (v ? `${v.length === 16 ? `${v}:00` : v}Z` : "");
  addBtn.addEventListener("click", () => {
    const s = toIso(start.value);
    const e = toIso(end.value);
    if (!s || !e || Date.parse(e) <= Date.parse(s)) {
      notify("error", "A busy period needs a start and a later end.");
      return;
    }
    c.busy.push({ start: s, end: e });
    state.cal.dirty = true;
    rerender();
  });
  return h(
    "details",
    {},
    h("summary", {}, `Busy periods (${c.busy.length})`),
    c.busy.length
      ? h(
          "ul",
          { class: "plain small" },
          c.busy.map((b, i) => {
            const rm = h(
              "button",
              { type: "button", "aria-label": `Remove busy period ${i + 1}` },
              "Remove",
            );
            rm.addEventListener("click", () => {
              c.busy.splice(i, 1);
              state.cal.dirty = true;
              rerender();
            });
            return h("li", {}, `${fmtSlot(b, "UTC")} UTC `, rm);
          }),
        )
      : h("p", { class: "small muted" }, "None."),
    h("div", { class: "row" }, field("Start (UTC)", start), field("End (UTC)", end), addBtn),
  );
}

function nextWeekday(iso) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function renderPreview(box) {
  const day = h("input", {
    type: "date",
    value: nextWeekday(state.cal.saved.clock),
    required: true,
  });
  const from = h("input", { type: "time", value: "08:00", required: true });
  const to = h("input", { type: "time", value: "17:00", required: true });
  const duration = h(
    "select",
    {},
    [30, 45, 60, 90].map((m) => h("option", { value: m }, `${m} minutes`)),
  );
  const out = h("div", { "aria-live": "polite" });
  const run = h("button", { type: "submit", class: "primary" }, "Preview with these settings");
  put(
    box,
    h("h2", { id: "cal-prev" }, "Preview scheduling"),
    h(
      "p",
      { class: "small" },
      "Uses the same scheduling code as the agent, with the settings above, including unsaved changes. Nothing is booked.",
    ),
    h(
      "p",
      { class: "small" },
      state.cal.saved.schedulingClock?.synthetic
        ? `Scheduling clock: ${fmtDate(state.cal.saved.schedulingClock.now)} (a fixed synthetic demo clock for previews only; history and account statuses use the real time).`
        : `Scheduling clock: the real time (${fmtDate(state.cal.saved.clock)}).`,
    ),
    h(
      "form",
      {
        events: {
          submit: (e) => {
            e.preventDefault();
            busy(run, async () => {
              const r = await api("POST", "/calendars/preview", {
                window: {
                  start: `${day.value}T${from.value}:00Z`,
                  end: `${day.value}T${to.value}:00Z`,
                },
                durationMinutes: Number(duration.value),
                draft: { calendars: state.cal.calendars, availability: state.cal.availability },
              });
              renderPreviewResult(out, r);
            });
          },
        },
      },
      h(
        "div",
        { class: "row" },
        field("Day", day),
        field("From (UTC)", from),
        field("To (UTC)", to),
        field("Length", duration),
        run,
      ),
    ),
    out,
  );
}

function renderPreviewResult(out, r) {
  const decision = {
    accept: "accept",
    counter: "propose other times",
    refuse: "refuse",
  }[r.peerOffer.decision];
  put(
    clear(out),
    r.status === "blocked"
      ? message(
          "error",
          "Blocked: the agent would not offer or accept any time.",
          h(
            "ul",
            { class: "plain" },
            r.reasons.map((x) => h("li", {}, x)),
          ),
        )
      : message("ok", `Ready. Times shown in ${r.timeZone}.`),
    h("h3", {}, "Free times the agent would offer"),
    r.freeSlots.length
      ? h(
          "ul",
          { class: "plain" },
          r.freeSlots.map((s) => h("li", {}, fmtSlot(s, r.timeZone))),
        )
      : h("p", { class: "empty" }, "No free time in this window."),
    h("h3", {}, "If another agent offered the first times of the window"),
    h(
      "p",
      {},
      `Offered: ${r.peerOffer.offered.map((s) => fmtSlot(s, r.timeZone)).join("; ") || "nothing"}.`,
    ),
    h(
      "p",
      {},
      `The agent would ${decision}`,
      r.peerOffer.slot ? `: ${fmtSlot(r.peerOffer.slot, r.timeZone)}` : "",
      r.peerOffer.counter
        ? `: ${r.peerOffer.counter.map((s) => fmtSlot(s, r.timeZone)).join("; ")}`
        : "",
      r.peerOffer.detail ? ` (${r.peerOffer.detail})` : "",
      ".",
    ),
  );
}

// ------------------------------------------------------------------ Permissions

function ruleTable(caption, rules) {
  if (!rules.length) return h("p", { class: "small muted" }, `${caption}: none.`);
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("caption", {}, caption),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ["Action", "On", "Purposes", "Recipients"].map((t) => h("th", { scope: "col" }, t)),
        ),
      ),
      h(
        "tbody",
        {},
        rules.map((r) =>
          h(
            "tr",
            {},
            h("td", {}, humanise(r.action)),
            h("td", {}, humanise(r.target)),
            h("td", {}, r.purposes.map(humanise).join(", ") || "—"),
            h("td", {}, r.recipients.join(", ") || "—"),
          ),
        ),
      ),
    ),
  );
}

async function viewPermissions(root) {
  const d = await api("GET", "/permissions");
  state.revision = d.revision;
  put(
    root,
    h("h1", { tabindex: "-1" }, "Permissions"),
    h(
      "p",
      { class: "lede" },
      "Three separate things decide what the agent may do: evidence that a provider connection works, your restrictions, and your communication policy. All three must allow an action. Being connected is not permission.",
    ),
    h(
      "section",
      { class: "panel", "aria-labelledby": "perm-b" },
      h("h2", { id: "perm-b" }, "Fixed boundaries"),
      h(
        "ul",
        { class: "plain" },
        d.boundaries.map((b) => h("li", {}, h("strong", {}, b.title), `. ${b.detail}`)),
      ),
    ),
  );
  const caps = Object.entries(d.capabilities);
  const summary = h(
    "table",
    {},
    h("caption", {}, "What the agent may do, per account"),
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, "Account"),
        caps.map(([, l]) => h("th", { scope: "col" }, l)),
      ),
    ),
    h(
      "tbody",
      {},
      d.matrix.map((row) =>
        h(
          "tr",
          {},
          h("th", { scope: "row" }, row.label),
          row.capabilities.map((c) =>
            h("td", {}, c.allowed ? badge("Allowed", "ok") : badge("Not allowed", "")),
          ),
        ),
      ),
    ),
  );
  const explainBox = h("div", { "aria-live": "polite" });
  const pick = h(
    "select",
    {},
    d.matrix.map((r) => h("option", { value: r.id }, r.label)),
  );
  const explain = () => {
    const row = d.matrix.find((r) => r.id === pick.value);
    clear(explainBox);
    if (!row) return;
    const layer = (l) => h("td", {}, l.ok ? badge("Yes", "ok") : badge("No", ""), " ", l.why);
    put(
      explainBox,
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h("caption", {}, `Why, for “${row.label}”`),
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              [
                "Capability",
                "Provider evidence",
                "Your restrictions",
                "Workflow policy",
                "Result",
              ].map((t) => h("th", { scope: "col" }, t)),
            ),
          ),
          h(
            "tbody",
            {},
            row.capabilities.map((c) =>
              h(
                "tr",
                {},
                h("th", { scope: "row" }, c.label),
                layer(c.provider),
                layer(c.owner),
                layer(c.policy),
                h("td", {}, c.allowed ? badge("Allowed", "ok") : badge("Not allowed", "")),
              ),
            ),
          ),
        ),
      ),
    );
  };
  pick.addEventListener("change", explain);
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "perm-m" },
      h("h2", { id: "perm-m" }, "Accounts"),
      d.matrix.length
        ? [
            h("div", { class: "table-wrap" }, summary),
            h("h3", {}, "Explain one account"),
            field("Account", pick),
            explainBox,
            h(
              "p",
              { class: "small muted" },
              "Change your restrictions on the Connections page. Provider access and your policy cannot be changed here.",
            ),
          ]
        : h("p", { class: "empty" }, "No accounts yet."),
    ),
  );
  if (d.matrix.length) explain();

  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "perm-c" },
      h("h2", { id: "perm-c" }, "Calendars"),
      d.calendars.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              {},
              h("caption", {}, "Reading availability and receiving bookings, per calendar"),
              h(
                "thead",
                {},
                h(
                  "tr",
                  {},
                  [
                    "Calendar",
                    "State",
                    "May read availability",
                    "Counts for availability",
                    "May receive bookings",
                    "Booking calendar",
                  ].map((t) => h("th", { scope: "col" }, t)),
                ),
              ),
              h(
                "tbody",
                {},
                d.calendars.map((c) =>
                  h(
                    "tr",
                    {},
                    h("th", { scope: "row" }, c.label),
                    h("td", {}, humanise(c.state)),
                    h("td", {}, c.readAvailability ? "Yes" : "No"),
                    h("td", {}, c.authoritative ? "Yes" : "No"),
                    h("td", {}, c.createBookings ? "Yes" : "No"),
                    h("td", {}, c.bookingTarget ? "Yes" : "No"),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "empty" }, "No calendars yet."),
    ),
  );

  const p = d.policy;
  const list = (items) =>
    items.length
      ? h(
          "ul",
          { class: "plain" },
          items.map((x) => h("li", {}, humanise(x))),
        )
      : "None";
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "perm-p" },
      h("h2", { id: "perm-p" }, "Your communication policy"),
      p
        ? [
            h(
              "p",
              { class: "small muted" },
              `Read-only copy from ${p.source}, last updated ${p.lastUpdated}. Change it at its source and import again.`,
            ),
            facts([
              ["Allowed by default (in approved workflows)", list(p.defaultAllowed)],
              ["Needs your current instruction", list(p.requiresCurrentInstruction)],
              ["Needs a fresh, explicit instruction", list(p.requiresFreshExplicitInstruction)],
              ["Ask you when uncertain about", list(p.askWhenUncertain)],
            ]),
          ]
        : h("p", { class: "empty" }, "Not imported. Without it, nothing is allowed."),
    ),
  );

  const agents = h(
    "section",
    { class: "panel", "aria-labelledby": "perm-a" },
    h("h2", { id: "perm-a" }, "Agents"),
  );
  if (!d.agents.length)
    put(agents, h("p", { class: "empty" }, "No agent is managed by this dashboard."));
  for (const a of d.agents) {
    put(
      agents,
      h(
        "h3",
        {},
        a.name,
        " ",
        a.found
          ? a.running
            ? badge("Running", "info")
            : badge("Stopped", "")
          : badge("Not found", "bad"),
      ),
    );
    if (!a.found) continue;
    put(
      agents,
      facts([
        ["Role", a.role],
        ["Party", a.party ? h("span", { class: "mono" }, a.party) : undefined],
        ["Agent", a.actor ? h("span", { class: "mono" }, a.actor) : undefined],
        ["Time zone", a.timeZone],
        ["Calendar data", a.calendarProblem ? `Unavailable: ${a.calendarProblem}` : undefined],
        [
          "Policy module",
          a.policyModule
            ? `${a.policyModule.evaluator ?? a.policyModule.engine ?? "unknown"} (recorded ${fmtDate(a.policyModule.recordedAt)})`
            : "Not recorded",
        ],
        [
          "Availability",
          !a.availability.applied
            ? "Not applied"
            : `${a.availability.blocked ? `Blocked: ${a.availability.blocked}. ` : "Applied. "}${useText(a.availability)}`,
        ],
        [
          "Synthetic holds",
          a.holds.length
            ? h(
                "ul",
                { class: "plain" },
                a.holds.map((x) => h("li", {}, `${x.title}: ${fmtSlot(x, a.timeZone ?? "UTC")}`)),
              )
            : "None",
        ],
      ]),
    );
    if (a.mandate)
      put(
        agents,
        h(
          "details",
          {},
          h("summary", {}, "Owner mandate"),
          h("p", { class: "small muted" }, a.mandate.note),
          facts([
            ["Valid from", fmtDate(a.mandate.validFrom)],
            ["Valid until", fmtDate(a.mandate.validUntil)],
          ]),
          ruleTable("The agent may do on its own", a.mandate.autonomous),
          ruleTable("Only with your approval", a.mandate.withApproval),
        ),
      );
    if (a.evidence)
      put(
        agents,
        h(
          "details",
          {},
          h("summary", {}, "Decisions and evidence"),
          h(
            "p",
            {},
            a.evidence.verified
              ? badge("Evidence chain verified", "ok")
              : badge("Evidence chain NOT verified", "bad"),
            ` ${a.evidence.entries} entries.`,
          ),
          facts(Object.entries(a.evidence.decisions).map(([k, n]) => [humanise(k), String(n)])),
          a.evidence.recent.length
            ? h(
                "div",
                { class: "table-wrap" },
                h(
                  "table",
                  {},
                  h("caption", {}, "Most recent decisions"),
                  h(
                    "thead",
                    {},
                    h(
                      "tr",
                      {},
                      ["When", "Outcome", "Action", "Operation"].map((t) =>
                        h("th", { scope: "col" }, t),
                      ),
                    ),
                  ),
                  h(
                    "tbody",
                    {},
                    a.evidence.recent.map((r) =>
                      h(
                        "tr",
                        {},
                        h("td", {}, fmtDate(r.at)),
                        h("td", {}, humanise(r.outcome)),
                        h("td", {}, humanise(r.action)),
                        h("td", {}, r.operation),
                      ),
                    ),
                  ),
                ),
              )
            : h("p", { class: "small muted" }, "No decisions yet."),
        ),
      );
  }
  put(root, agents);
}

// ------------------------------------------------------------------ Message triage

const EXAMPLES = [
  {
    name: "A question about a meeting",
    from: "sam@example.org",
    subject: "Thursday?",
    body: "Could you let me know whether Thursday afternoon still works for the review?",
  },
  {
    name: "An invoice",
    from: "billing@example.com",
    subject: "Invoice 1042",
    body: "Please pay the attached invoice within 14 days.",
  },
  {
    name: "A newsletter",
    from: "news@example.net",
    subject: "This week's digest",
    body: "Our weekly newsletter. To stop receiving these, unsubscribe here.",
  },
  {
    name: "A message from another agent",
    from: "agent@example.org",
    subject: "Meeting proposal",
    body: 'Content-Type: application/json\nX-AWP-Profile: https://example.org/awp\n\n{"@type":"SignedMessage","format":"awp-jws-compact/0.1","jws":"(synthetic)"}',
  },
];

async function viewTriage(root) {
  const d = await api("GET", "/triage");
  state.revision = d.revision;
  const hosted = d.hosted;
  put(
    root,
    h("h1", { tabindex: "-1" }, "Message triage"),
    h(
      "p",
      { class: "lede" },
      "Suggestions for sorting a message: whether it needs a reply, what kind of message it is, and how urgent it is. A suggestion never permits an action, and when the agent is unsure it asks you.",
    ),
    h(
      "section",
      { class: "panel", "aria-labelledby": "tr-how" },
      h("h2", { id: "tr-how" }, "How it works"),
      h(
        "ol",
        { class: "plain" },
        h(
          "li",
          {},
          "Text that looks like a structured agent message is never classified. The marker proves nothing; the agent's protocol validation (signature, trust and permission checks) decides what it is.",
        ),
        h(
          "li",
          {},
          "Local rules always run first. They are a simple baseline with deliberately low confidence, so they usually ask you.",
        ),
        h(
          "li",
          {},
          "Hosted triage (TypeSafe) runs only when all of these hold: a key is configured on this machine, you turned it on here, you confirm each sample, and, for an account, you allowed it on the Connections page. If it fails or is unsure, you are asked.",
        ),
      ),
    ),
  );

  // Hosted settings
  const toggle = h("input", { type: "checkbox", checked: hosted.enabled });
  const save = h("button", { type: "submit", class: "primary" }, "Save");
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "tr-hosted" },
      h("h2", { id: "tr-hosted" }, "Hosted triage (TypeSafe)"),
      facts([
        [
          "Key on this machine",
          hosted.configured ? badge("Configured", "info") : badge("Not configured", ""),
        ],
        ["Turned on here", hosted.enabled ? "Yes" : "No"],
        ["Model", h("span", { class: "mono" }, hosted.model)],
        ["Sent to", h("span", { class: "mono" }, hosted.endpoint)],
      ]),
      hosted.problem ? message("error", hosted.problem) : null,
      h("h3", {}, "What is sent when you use it"),
      h(
        "p",
        {},
        "For each sample you confirm, its sender, subject and body, with the category descriptions, are sent over HTTPS to TypeSafe. Nothing is sent otherwise: no inbox is read, and no message is sent automatically. TypeSafe states that requests are not used for training. Check its data processing terms and your account's retention settings before turning this on.",
      ),
      h(
        "ul",
        { class: "plain" },
        h(
          "li",
          {},
          h(
            "a",
            {
              href: "https://typesafe.ai/legal/data-processing",
              rel: "noreferrer",
              target: "_blank",
            },
            "TypeSafe data processing terms (opens in a new tab)",
          ),
        ),
        h(
          "li",
          {},
          h(
            "a",
            {
              href: "https://typesafe.ai/legal/privacy-policy",
              rel: "noreferrer",
              target: "_blank",
            },
            "TypeSafe privacy policy (opens in a new tab)",
          ),
        ),
      ),
      h(
        "form",
        {
          events: {
            submit: (e) => {
              e.preventDefault();
              busy(save, async () => {
                const r = await api("PUT", "/triage", {
                  baseRevision: state.revision,
                  hostedEnabled: toggle.checked,
                });
                await route();
                notify(
                  "ok",
                  `Hosted triage is ${r.enabled ? "on" : "off"}. Settings revision ${r.revision}.`,
                );
              });
            },
          },
        },
        check(
          "Turn on hosted triage",
          toggle,
          hosted.configured
            ? "Samples are still sent only when you confirm each one."
            : "It stays unavailable until a key is configured on this machine.",
        ),
        h("div", { class: "actions" }, save),
      ),
      h(
        "details",
        { open: !hosted.configured },
        h("summary", {}, "Setting up a TypeSafe key"),
        h(
          "ol",
          { class: "plain" },
          h(
            "li",
            {},
            "Create an account at ",
            h(
              "a",
              { href: "https://console.typesafe.ai", rel: "noreferrer", target: "_blank" },
              "the TypeSafe console (opens in a new tab)",
            ),
            ". Use only this official address.",
          ),
          h("li", {}, "Create an API key there and keep it in your own secret store."),
          h(
            "li",
            {},
            "Start the dashboard with the key in its environment, without typing the key into the command itself (so it stays out of shell history), for example: ",
            h(
              "code",
              {},
              "read -rs TYPESAFE_API_KEY && export TYPESAFE_API_KEY && npm run dashboard",
            ),
            ".",
          ),
          h(
            "li",
            {},
            "Optionally pin a model version with ",
            h("code", {}, "TYPESAFE_MODEL=jev-1.13.0"),
            ". Only pinned versions are accepted.",
          ),
          h(
            "li",
            {},
            "Restart the dashboard, turn hosted triage on here, and try a synthetic sample.",
          ),
        ),
        h(
          "p",
          { class: "small" },
          "Never paste the key into this page or into a chat. The dashboard never shows, stores or logs it.",
        ),
      ),
    ),
  );

  // Sample form
  const from = h("input", { type: "text", maxlength: 200 });
  const subject = h("input", { type: "text", maxlength: 300 });
  const body = h("textarea", { rows: 6, maxlength: 4000, required: true });
  const example = h(
    "select",
    {},
    h("option", { value: "" }, "Write your own"),
    EXAMPLES.map((x, i) => h("option", { value: String(i) }, x.name)),
  );
  example.addEventListener("change", () => {
    const x = EXAMPLES[Number(example.value)];
    if (!x) return;
    from.value = x.from;
    subject.value = x.subject;
    body.value = x.body;
  });
  const account = h(
    "select",
    {},
    h("option", { value: "" }, "No account (synthetic sandbox)"),
    d.accounts.map((a) => h("option", { value: a.id }, a.label)),
  );
  const synthetic = h("input", { type: "checkbox", required: true });
  const hostedAvailable = hosted.configured && hosted.enabled;
  const useHosted = h("input", { type: "checkbox", disabled: !hostedAvailable });
  const consent = h("input", { type: "checkbox", disabled: true });
  useHosted.addEventListener("change", () => {
    consent.disabled = !useHosted.checked;
    if (!useHosted.checked) consent.checked = false;
  });
  const result = h("div", { "aria-live": "polite" });
  const run = h("button", { type: "submit", class: "primary" }, "Suggest triage");
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "tr-try" },
      h("h2", { id: "tr-try" }, "Try a synthetic sample"),
      h(
        "p",
        { class: "small" },
        "Write or choose a made-up message. Do not paste real messages: this version handles synthetic samples only.",
      ),
      h(
        "form",
        {
          events: {
            submit: (e) => {
              e.preventDefault();
              busy(run, async () => {
                const r = await api("POST", "/triage/classify", {
                  sample: {
                    ...(from.value.trim() ? { from: from.value.trim() } : {}),
                    subject: subject.value,
                    body: body.value,
                  },
                  synthetic: synthetic.checked === true ? true : undefined,
                  ...(account.value ? { accountId: account.value } : {}),
                  useHosted: useHosted.checked,
                  consent: consent.checked,
                });
                renderTriageResult(result, r);
              });
            },
          },
        },
        field("Example", example),
        h("div", { class: "row" }, field("From", from), field("Subject", subject)),
        field("Message", body),
        field(
          "Account",
          account,
          "Linking a sample to an account applies that account's restrictions (included, read and triage, plus hosted permission for hosted triage). Without an account the sample is a synthetic sandbox.",
        ),
        check("This sample is made up (not a real message)", synthetic),
        check(
          "Use hosted triage (TypeSafe)",
          useHosted,
          hostedAvailable
            ? undefined
            : hosted.configured
              ? "Turn hosted triage on above first."
              : "Not available: no key is configured on this machine.",
        ),
        check("Send this sample to TypeSafe", consent, "Your confirmation for this sample only."),
        h("div", { class: "actions" }, run),
      ),
      result,
    ),
  );

  // Taxonomy
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "tr-tax" },
      h("h2", { id: "tr-tax" }, "Categories"),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h("caption", {}, "Kinds of message (one per message) and urgency (separate)"),
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", { scope: "col" }, "Category"),
              h("th", { scope: "col" }, "Meaning"),
            ),
          ),
          h(
            "tbody",
            {},
            Object.entries(d.taxonomy.primary).map(([k, v]) =>
              h("tr", {}, h("th", { scope: "row" }, humanise(k)), h("td", {}, v)),
            ),
            Object.entries(d.taxonomy.urgency).map(([k, v]) =>
              h("tr", {}, h("th", { scope: "row" }, `${humanise(k)} (urgency)`), h("td", {}, v)),
            ),
          ),
        ),
      ),
      h(
        "p",
        { class: "small muted" },
        `Answers below ${d.thresholds.primary} confidence become “uncertain” and you are asked. These thresholds are uncalibrated defaults, not measured on real data. No quality or cost claim is made from tests.`,
      ),
    ),
  );
}

function renderTriageResult(out, r) {
  const conf = (v) => (v === null || v === undefined ? "—" : v.toFixed(2));
  put(
    clear(out),
    h("h3", {}, "Suggestion"),
    r.route === "agent-protocol"
      ? message(
          "",
          "Possible structured agent message. It carries an agent-protocol marker, which proves nothing by itself: it is not classified, and the agent's protocol validation decides what it is.",
        )
      : facts([
          [
            "Kind",
            r.primary === "uncertain"
              ? `Uncertain (best guess: ${r.primaryCandidate ? humanise(r.primaryCandidate) : "none"}), so you are asked`
              : humanise(r.primary),
          ],
          ["Urgency", humanise(r.urgency)],
          ["Needs a reply", humanise(r.needsReply)],
          [
            "Confidence",
            `kind ${conf(r.confidence.primary)}, urgency ${conf(r.confidence.urgency)}, reply ${conf(r.confidence.needsReply)}`,
          ],
          [
            "Chosen-label probability",
            r.probability
              ? `kind ${conf(r.probability.primary)}, urgency ${conf(r.probability.urgency)}`
              : undefined,
          ],
          [
            "Full distribution",
            r.distribution
              ? Object.entries(r.distribution.primary)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${humanise(k)} ${conf(v)}`)
                  .join(", ")
              : undefined,
          ],
          [
            "Source",
            r.source === "typesafe"
              ? `TypeSafe (${r.model})`
              : r.source === "deterministic-baseline"
                ? "Local rules"
                : "None",
          ],
          ["Ask you about", r.askOwner.length ? r.askOwner.join(", ") : "Nothing"],
          ["Hosted triage", `${humanise(r.hosted.status)}: ${r.hosted.detail}`],
        ]),
    h(
      "ul",
      { class: "plain small" },
      r.reasons.map((x) => h("li", {}, x)),
    ),
    h(
      "p",
      { class: "small" },
      h("strong", {}, "A suggestion only."),
      " It does not permit reading, replying, sending or any other action.",
    ),
  );
}

// ------------------------------------------------------------------ Actions

const EFFECT_TEXT = {
  read: "Reads only",
  prepare: "Prepares content only",
  "local-write": "Changes local agent state (operator execution)",
};
const MODE_TEXT = {
  none: "No provider access is configured on this server: provider calendars report “needs setup”.",
  fixture:
    "Synthetic provider fixtures: Google and Microsoft answers are invented test data (no network).",
  live: "Live provider access through the operator's credential helper (read-only calendar availability).",
};
const CREDENTIAL_TEXT = {
  configured: "Configured",
  "fixture-simulation": "Simulated (fixtures, no credential)",
  none: "None",
};
const STATUS_BADGE = {
  ok: "ok",
  blocked: "bad",
  "needs-setup": "warn",
  "needs-review": "warn",
  refused: "bad",
};

function tableOf(caption, headings, rows) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("caption", {}, caption),
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          headings.map((t) => h("th", { scope: "col" }, t)),
        ),
      ),
      h(
        "tbody",
        {},
        rows.map((cells) =>
          h(
            "tr",
            {},
            cells.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", {}, c))),
          ),
        ),
      ),
    ),
  );
}

function renderActionResult(out, report) {
  const r = report.result;
  const parts = [
    h("h3", {}, "Result"),
    h(
      "p",
      {},
      badge(humanise(report.status), STATUS_BADGE[report.status]),
      ` ${report.action} · ${report.phase}`,
    ),
    report.reasons?.length
      ? h(
          "ul",
          { class: "plain small" },
          report.reasons.map((x) => h("li", {}, x)),
        )
      : null,
  ];
  if (r?.proposals?.length)
    parts.push(
      tableOf(
        "Proposed times",
        ["Rank", "Time"],
        r.proposals.map((p) => [String(p.rank), p.local]),
      ),
    );
  if (r?.options?.length)
    parts.push(
      tableOf(
        "Options",
        ["Rank", "Time"],
        r.options.map((p) => [String(p.rank), p.local]),
      ),
    );
  const coverage = r?.sources ?? r?.coverage;
  if (coverage?.length)
    parts.push(
      tableOf(
        "Calendars read (coverage)",
        ["Calendar", "State", "Detail", "Fetched"],
        coverage.map((s) => [
          s.label,
          humanise(s.state),
          s.reason ?? s.detail ?? "",
          s.fetchedAt ? fmtDate(s.fetchedAt) : "—",
        ]),
      ),
    );
  if (r?.validUntil)
    parts.push(
      h(
        "p",
        { class: "small muted" },
        `Valid until ${fmtDate(r.validUntil)}; recompute after that.`,
      ),
    );
  if (r?.templates)
    parts.push(
      h("h3", {}, "Email template"),
      h(
        "pre",
        { class: "prepared" },
        `Subject: ${r.templates.email.subject}\n\n${r.templates.email.text}`,
      ),
      h("h3", {}, "Chat template"),
      h("pre", { class: "prepared" }, r.templates.chat.text),
    );
  if (r?.prepared)
    parts.push(
      h("h3", {}, `Prepared ${r.renderer} content for ${r.accountId}`),
      h(
        "pre",
        { class: "prepared" },
        `${r.prepared.subject ? `Subject: ${r.prepared.subject}\n\n` : ""}${r.prepared.text}`,
      ),
      h(
        "ul",
        { class: "plain small" },
        r.basis ? h("li", {}, r.basis.note) : null,
        h("li", {}, r.delivery.providerDraft),
        h("li", {}, r.delivery.send),
      ),
    );
  if (r?.slot)
    parts.push(
      h(
        "p",
        {},
        `${r.slot.local}: `,
        r.free ? badge("Free", "ok") : badge("Not free", "bad"),
        ` ${r.booking}`,
      ),
    );
  if (r?.queue)
    parts.push(
      tableOf(
        "Action queue",
        ["Item", "Category", "Next", "Rule"],
        r.queue.map((q) => [q.id, humanise(q.category), q.next.action ?? q.next.route, q.rule]),
      ),
      r.excluded.length
        ? tableOf(
            "Excluded",
            ["Item", "Why"],
            r.excluded.map((x) => [x.id, x.why]),
          )
        : null,
    );
  if (r?.channels)
    parts.push(
      h(
        "p",
        {},
        "Certainty: ",
        badge(humanise(r.certainty), r.certainty === "recorded" ? "ok" : "warn"),
        ` ${r.identity}`,
      ),
      r.verification ? h("p", { class: "muted" }, r.verification) : null,
      r.channels.length
        ? tableOf(
            "Channels",
            ["Kind", "Status", "Detail"],
            r.channels.map((c) => [humanise(c.kind), humanise(c.status), c.detail]),
          )
        : null,
    );
  if (r?.families)
    for (const f of r.families)
      parts.push(
        tableOf(
          `${f.family} (${f.accounts.length} accounts)`,
          ["Capability", "Status", "How"],
          f.capabilities.map((c) => [c.capability, humanise(c.status), c.via]),
        ),
      );
  if (report.execution) parts.push(message("warn", report.execution));
  parts.push(
    h(
      "details",
      {},
      h("summary", {}, "Full result (JSON)"),
      h("pre", { class: "prepared" }, JSON.stringify(report, null, 2)),
    ),
  );
  put(clear(out), ...parts);
}

async function viewActions(root) {
  const d = await api("GET", "/actions");
  put(
    root,
    h("h1", { tabindex: "-1" }, "Actions"),
    h(
      "p",
      { class: "lede" },
      "Common operations the agent performs deterministically, with no language model: availability across your calendars, meeting proposals, contact lookup, reply preparation and an action queue. Previews here never send, book or change anything.",
    ),
    message(
      d.providerMode === "live" ? "" : "warn",
      MODE_TEXT[d.providerMode],
      d.schedulingClock.synthetic
        ? `Scheduling clock: ${fmtDate(d.schedulingClock.now)} (synthetic demo clock).`
        : null,
    ),
  );
  put(
    root,
    h(
      "section",
      { class: "panel", "aria-labelledby": "act-perm" },
      h("h2", { id: "act-perm" }, "What the actions may use"),
      d.permissions.calendars.length
        ? tableOf(
            "Calendars counted for availability",
            ["Calendar", "Readable", "Why"],
            d.permissions.calendars.map((p) => [p.subject, p.allowed ? "Yes" : "No", p.why]),
          )
        : h("p", { class: "empty" }, "No calendar counts for availability."),
      tableOf(
        "Accounts",
        ["Account", "Included", "Reply preparation", "Queue (triage)", "Provider credential"],
        d.permissions.accounts.map((a) => [
          a.label,
          a.included ? "Yes" : "No",
          a.draft ? "Allowed" : "No",
          a.triage ? "Allowed" : "No",
          CREDENTIAL_TEXT[a.credential] ?? "None",
        ]),
      ),
      h(
        "p",
        { class: "small muted" },
        "Change these on the Connections and Calendars pages. Nothing in an action request can grant a permission.",
      ),
    ),
  );
  for (const a of d.actions) {
    const id = `act-${a.id.replace(/[^a-z0-9]/g, "-")}`;
    const input = h(
      "textarea",
      { rows: 10, class: "mono", spellcheck: "false" },
      JSON.stringify(a.example ?? {}, null, 2),
    );
    const out = h("div", { "aria-live": "polite" });
    const run = h(
      "button",
      { type: "submit", class: "primary" },
      a.effect === "local-write" ? "Check (prepare only)" : "Run preview",
    );
    put(
      root,
      h(
        "section",
        { class: "panel", "aria-labelledby": id },
        h("h2", { id }, a.title),
        h(
          "p",
          {},
          h("code", {}, a.id),
          " ",
          badge(EFFECT_TEXT[a.effect] ?? a.effect, a.effect === "local-write" ? "warn" : "info"),
        ),
        h("p", {}, a.description),
        a.capabilities.length
          ? h("p", { class: "small" }, `Needs: ${a.capabilities.join(", ")}.`)
          : null,
        h(
          "details",
          {},
          h("summary", {}, "Limitations"),
          h(
            "ul",
            { class: "plain small" },
            a.limitations.map((l) => h("li", {}, l)),
          ),
        ),
        a.phases.includes("execute")
          ? h(
              "p",
              { class: "small" },
              "Execution changes local agent state and is an operator step (CLI or MCP); it cannot be run from this page.",
            )
          : null,
        h(
          "form",
          {
            events: {
              submit: (e) => {
                e.preventDefault();
                let value;
                try {
                  value = JSON.parse(input.value);
                } catch {
                  notify("error", "The input is not valid JSON.");
                  return;
                }
                busy(run, async () =>
                  renderActionResult(
                    out,
                    await api("POST", `/actions/${encodeURIComponent(a.id)}/prepare`, {
                      input: value,
                    }),
                  ),
                );
              },
            },
          },
          field(
            "Input (JSON)",
            input,
            "Prefilled with an example; the schema is in the full catalogue.",
          ),
          h("div", { class: "actions" }, run),
        ),
        out,
      ),
    );
  }
}

start();
