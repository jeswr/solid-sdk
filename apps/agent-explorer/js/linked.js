// AUTHORED-BY Codex GPT-6.2 Sol
((root) => {
  const contextFiles = new Map([
    ["https://w3id.org/jeswr/awp/context/v1", ["v1.jsonld", "Message context"]],
    ["https://w3id.org/jeswr/awp/context/store/v1", ["store-v1.jsonld", "Store context"]],
    ["https://w3id.org/jeswr/awp/context/odrl/v1", ["odrl-v1.jsonld", "ODRL context"]],
    ["https://w3id.org/jeswr/awp/context/scenario/v1", ["scenario-v1.jsonld", "Scenario context"]],
  ]);

  function packet(value) {
    const text = value.rdf || value.turtle || value.trig;
    // The packet writer emits a named graph at the start of a line in TriG.
    const namedGraph = /^\s*(?:GRAPH\s+)?(?:<[^>\r\n]+>|[\w-]*:[^\s{}]+)\s+\{/im;
    return {
      jsonld: value.jsonld,
      context: value.context,
      text,
      textName: value.rdf
        ? namedGraph.test(text)
          ? "TriG"
          : "Turtle"
        : value.turtle
          ? "Turtle"
          : "TriG",
    };
  }

  function entries(trace, event) {
    if (!trace.linked || !Array.isArray(event.linked)) return [];
    return event.linked.flatMap((key) =>
      typeof key === "string" && Object.hasOwn(trace.linked, key) && trace.linked[key]
        ? [trace.linked[key]]
        : [],
    );
  }

  function tablePath(trace) {
    const path = trace.linkedTable;
    const match = typeof path === "string" && /^linked\/([a-zA-Z0-9_-]+)\.json$/.exec(path);
    const id = trace.scenario.id;
    if (
      !match ||
      trace.linked !== undefined ||
      (id !== match[1] && !id.startsWith(`${match[1]}--`))
    ) {
      throw new Error("Invalid linked table reference.");
    }
    return path;
  }

  function validateTable(table) {
    const isText = (value) => typeof value === "string" && value.length > 0;
    if (!table || typeof table !== "object" || Array.isArray(table))
      throw new Error("Invalid linked view table.");
    for (const [key, view] of Object.entries(table)) {
      const contexts = Array.isArray(view?.context) ? view.context : [view?.context];
      if (
        !/^sha-256:[a-f0-9]{64}$/.test(key) ||
        !["policy", "trust-entry", "record-entry", "memory-item"].includes(view?.what) ||
        !contexts.length ||
        !contexts.every(isText) ||
        !isText(view.jsonld) ||
        !isText(view.turtle)
      )
        throw new Error("Invalid linked view table.");
    }
    return table;
  }

  function checkKeys(trace, table) {
    for (const event of trace.events) {
      if (event.linked === undefined) continue;
      if (
        !Array.isArray(event.linked) ||
        !event.linked.every((key) => typeof key === "string" && Object.hasOwn(table, key))
      ) {
        throw new Error(`A linked view is missing from ${trace.linkedTable}.`);
      }
    }
  }

  const tableLoads = new Map();
  async function load(trace, traceUrl) {
    if (trace.linkedTable === undefined) return;
    try {
      const path = tablePath(trace);
      const url = traceUrl.slice(0, traceUrl.lastIndexOf("/") + 1) + path;
      if (!tableLoads.has(url)) {
        tableLoads.set(
          url,
          fetch(url)
            .then((response) => {
              if (!response.ok) throw new Error("Linked view table unavailable");
              return response.json();
            })
            .then(validateTable)
            .catch((error) => {
              tableLoads.delete(url);
              throw error;
            }),
        );
      }
      const table = await tableLoads.get(url);
      checkKeys(trace, table);
      trace.linked = table;
    } catch {
      trace.linkedTableUnavailable = true;
    }
  }

  function jsonDocument(value, fallback, expanded) {
    if (value == null) return {};
    let doc = value;
    if (typeof value === "string") {
      try {
        doc = JSON.parse(value);
      } catch {
        return { json: value };
      }
    }
    if (typeof doc !== "object" || !doc || Array.isArray(doc))
      return { json: JSON.stringify(doc, null, 2) };
    const { "@context": context = fallback, ...fields } = doc;
    return {
      context,
      json: JSON.stringify(
        expanded && context !== undefined ? { "@context": context, ...fields } : fields,
        null,
        2,
      ),
    };
  }

  function code(text, language, label, id = "") {
    return `<pre class="json rdf-doc"${id ? ` id="${id}"` : ""} tabindex="0" aria-label="${label}"><code>${root.AX.highlight(text, language)}</code></pre>`;
  }

  function contextLinks(context) {
    const files = (Array.isArray(context) ? context : [context]).flatMap((iri) =>
      contextFiles.has(iri) ? [contextFiles.get(iri)] : [],
    );
    return files
      .map(
        ([file, label]) =>
          `<a href="data/contexts/${file}" data-rdf-document="${file}" aria-label="Open the context: ${label}">${files.length === 1 ? "Open the context" : label}</a>`,
      )
      .join(" ");
  }

  function panes(input, id, expanded) {
    const { json, context } = jsonDocument(input.jsonld, input.context, expanded);
    const text = input.text ?? input.turtle;
    const label = input.textName === "TriG" ? "TriG" : "Turtle";
    const jsonId = id + "-jsonld";
    let note = "";
    if (context !== undefined) {
      note = `<div class="rdf-note">${expanded ? "" : "The context, which maps each short name to a full term, is folded away."}
        <button type="button" class="linkish" data-rdf-context aria-controls="${jsonId}" aria-expanded="${expanded}">${expanded ? "Hide context" : "Show context"}</button>
        ${expanded ? contextLinks(context) : ""}</div>`;
    }
    const jsonPane = `<div class="rdf-pane"><h4>JSON-LD</h4>${json === undefined ? '<p class="rdf-note">JSON-LD was not recorded.</p>' : code(json, "jsonld", "JSON-LD", jsonId) + note}</div>`;
    const rdfPane = `<div class="rdf-pane"><h4>${label}</h4>${text ? code(text, label, label) : '<p class="rdf-note">Turtle was not recorded.</p>'}</div>`;
    return `<div class="rdf-panes">${jsonPane}${rdfPane}</div>`;
  }

  function html(input, { id, context = false, title = "RDF view", message = false }) {
    if (input.jsonld == null && !(input.text ?? input.turtle)) return "";
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("Invalid RDF view id");
    return `<div class="rdf rdf-view" id="${id}"${message ? ' data-anchor="inspector.message.rdf"' : ""}>
      <div class="rdf-head"><h3>${root.AX.highlight(title, "text")}</h3><button class="linkish" type="button" data-rdf-open aria-haspopup="dialog">Open side by side</button></div>
      ${panes(input, id, context)}
    </div>`;
  }

  function bind(inspector, dialog, { getInput, getContext, toggleContext, pause }) {
    const content = dialog.querySelector(".rdf-dialog-content");
    const close = dialog.querySelector("[data-rdf-close]");
    let origin;
    let current;
    function show(input) {
      current = input;
      content.innerHTML = panes(input, "rdf-wide", getContext());
    }
    function open(trigger) {
      pause();
      origin = { id: trigger.closest(".rdf-view").id, action: trigger.dataset.rdfDocument ?? "" };
      dialog.showModal();
      close.focus();
    }

    function openContext(e, link) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const file = link.dataset.rdfDocument;
      const match = [...contextFiles.values()].find(([name]) => name === file);
      if (!match) return;
      e.preventDefault();
      current = undefined;
      if (!dialog.open) open(link);
      close.focus();
      const panel = dialog.ownerDocument.createElement("div");
      panel.className = "rdf-context-document";
      panel.textContent = "Loading context…";
      content.replaceChildren(panel);
      fetch(link.href)
        .then((response) => {
          if (!response.ok) throw new Error("Context document unavailable");
          return response.text();
        })
        .then((text) => {
          if (panel.isConnected)
            panel.innerHTML = `<h4>${match[1]}</h4>${code(text, "jsonld", match[1])}`;
        })
        .catch(() => {
          panel.textContent = "The bundled context could not be opened.";
        });
    }

    inspector.addEventListener("click", (e) => {
      const view = e.target.closest(".rdf-view");
      if (!view) return;
      const link = e.target.closest("[data-rdf-document]");
      if (link) openContext(e, link);
      if (e.target.closest("[data-rdf-open]")) {
        show(getInput(view.id));
        open(e.target);
      }
      if (e.target.closest("[data-rdf-context]")) {
        toggleContext();
        inspector.querySelector(`#${view.id} [data-rdf-context]`)?.focus();
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target.closest("[data-rdf-close]")) dialog.close();
      const link = e.target.closest("[data-rdf-document]");
      if (link) openContext(e, link);
      if (current && e.target.closest("[data-rdf-context]")) {
        toggleContext();
        show(current);
        content.querySelector("[data-rdf-context]")?.focus();
      }
    });
    dialog.addEventListener("close", () => {
      content.replaceChildren();
      current = undefined;
      if (!origin) return;
      const view = inspector.querySelector(`#${origin.id}`);
      const selector = origin.action ? `[data-rdf-document="${origin.action}"]` : "[data-rdf-open]";
      view?.querySelector(selector)?.focus();
      origin = undefined;
    });
    // Let the pane scroll and the modal handle Escape using their native keyboard behaviour.
    inspector.addEventListener("keydown", (e) => {
      if (e.target.closest(".rdf-view")) e.stopPropagation();
    });
    dialog.addEventListener("keydown", (e) => e.stopPropagation());
  }

  const api = { bind, checkKeys, entries, html, load, packet, tablePath, validateTable };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AX.linked = api;
})(typeof window !== "undefined" ? window : globalThis);
