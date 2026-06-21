import {
  AbstractFormElement,
  AbstractReadElement,
  AccessDeniedError,
  BASE_INPUT_PROPS,
  Bookmark,
  Contact,
  DataController,
  DataControllerError,
  DataFormatError,
  DataWriter,
  EMPTY_SHAPES_MESSAGE,
  JeswrBookmarkForm,
  JeswrContactForm,
  JeswrShaclForm,
  JeswrShaclView,
  JeswrTaskForm,
  LiteralAs,
  N3DataFactory_default,
  N3Store,
  NamedNodeAs,
  NamedNodeFrom,
  NetworkError,
  NotFoundError,
  OptionalFrom,
  SetFrom,
  Task,
  TermAs,
  TermWrapper,
  UnconditionalOverwriteError,
  VALUES_SUBJECT_SENTINEL,
  WriteConflictError,
  WriteFailedError,
  WriteScopeError,
  b,
  classifyReadError,
  countTurtleQuads,
  defaultBaseFor,
  findEditedSubject,
  formatDate,
  i,
  neutraliseValuesTurtle,
  resolveAndHarden,
  resolveGraphToTurtle,
  safeHref,
  safeMailto,
  safeTel,
  serializeTurtle,
  stripScheme
} from "./chunks/chunk-2QY2TDIE.js";
import "./chunks/chunk-BNRDLDVI.js";

// src/vocab.ts
var TASK_CLASS = "http://www.w3.org/2005/01/wf/flow#Task";
var VCARD_INDIVIDUAL = "http://www.w3.org/2006/vcard/ns#Individual";
var VCARD_ADDRESS_BOOK = "http://www.w3.org/2006/vcard/ns#AddressBook";
var BOOKMARK_CLASS = "https://w3id.org/jeswr/bookmark#Bookmark";
var LDP_CONTAINER = "http://www.w3.org/ns/ldp#Container";
var LDP_BASIC_CONTAINER = "http://www.w3.org/ns/ldp#BasicContainer";
var RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// src/components/task-list.ts
var JeswrTaskList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: result.url };
  }
  renderReady(graph) {
    const tasks = collectTasks(graph);
    if (tasks.length === 0) {
      return b`<slot name="empty"><p part="empty">No tasks.</p></slot>`;
    }
    return b`
      <ul part="list">
        ${tasks.map((t) => this.#renderTask(t))}
      </ul>
    `;
  }
  #renderTask(task) {
    const meta = [];
    if (task.assignee) meta.push(`Assignee: ${task.assignee}`);
    if (task.priority) meta.push(`Priority: ${task.priority}`);
    const due = formatDate(task.dueDate);
    if (due) meta.push(`Due: ${due}`);
    return b`
      <li part="task" data-state=${task.state}>
        <span part="title">${task.title ?? "(untitled task)"}</span>
        <span part="state" data-state=${task.state}>${task.state}</span>
        ${task.description ? b`<p>${task.description}</p>` : null}
        ${meta.length > 0 ? b`<small part="meta">${meta.join(" \xB7 ")}</small>` : null}
      </li>
    `;
  }
};
function collectTasks(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== TASK_CLASS) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(new Task(subject, graph, N3DataFactory_default));
  }
  return out;
}
if (!customElements.get("jeswr-task-list")) {
  customElements.define("jeswr-task-list", JeswrTaskList);
}

// src/components/contact-list.ts
var JeswrContactList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: result.url };
  }
  renderReady(graph) {
    const contacts = collectContacts(graph);
    if (contacts.length === 0) {
      return b`<slot name="empty"><p part="empty">No contacts.</p></slot>`;
    }
    return b`
      <ul part="list">
        ${contacts.map((c) => this.#renderContact(c))}
      </ul>
    `;
  }
  #renderContact(contact) {
    const webIdHref = safeHref(contact.webId);
    return b`
      <li part="contact">
        <span part="name">${contact.name ?? "(unnamed contact)"}</span>
        ${contact.organization ? b`<small>${contact.organization}</small>` : null}
        ${this.#renderEmails(contact.emails)} ${this.#renderPhones(contact.phones)}
        ${webIdHref ? b`<a part="webid" href=${webIdHref} rel="noopener noreferrer">${contact.webId}</a>` : null}
        ${contact.note ? b`<p>${contact.note}</p>` : null}
      </li>
    `;
  }
  #renderEmails(emails) {
    if (emails.length === 0) return null;
    return b`<ul part="emails">
      ${emails.map((e) => {
      const href = safeMailto(e);
      const text = stripScheme(e);
      return b`<li>
          ${href ? b`<a href=${href}>${text}</a>` : b`<span>${text}</span>`}
        </li>`;
    })}
    </ul>`;
  }
  #renderPhones(phones) {
    if (phones.length === 0) return null;
    return b`<ul part="phones">
      ${phones.map((p) => {
      const href = safeTel(p);
      const text = stripScheme(p);
      return b`<li>
          ${href ? b`<a href=${href}>${text}</a>` : b`<span>${text}</span>`}
        </li>`;
    })}
    </ul>`;
  }
};
function collectContacts(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== VCARD_INDIVIDUAL) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(new Contact(subject, graph, N3DataFactory_default));
  }
  return out;
}
if (!customElements.get("jeswr-contact-list")) {
  customElements.define("jeswr-contact-list", JeswrContactList);
}

// node_modules/@solid/object/dist/vocabulary/foaf.js
var FOAF = {
  isPrimaryTopicOf: "http://xmlns.com/foaf/0.1/isPrimaryTopicOf",
  primaryTopic: "http://xmlns.com/foaf/0.1/primaryTopic",
  name: "http://xmlns.com/foaf/0.1/name",
  email: "http://xmlns.com/foaf/0.1/email",
  homepage: "http://xmlns.com/foaf/0.1/homepage",
  knows: "http://xmlns.com/foaf/0.1/knows",
  /**
   * @remarks [When used in WAC](https://solidproject.org/TR/wac#acl-agentclass-foaf-agent), allows access to any agent, i.e., the public.
   */
  Agent: "http://xmlns.com/foaf/0.1/Agent"
};

// node_modules/@solid/object/dist/vocabulary/pim.js
var PIM = {
  storage: "http://www.w3.org/ns/pim/space#storage"
};

// node_modules/@solid/object/dist/vocabulary/solid.js
var SOLID = {
  oidcIssuer: "http://www.w3.org/ns/solid/terms#oidcIssuer",
  storage: "http://www.w3.org/ns/solid/terms#storage"
};

// node_modules/@solid/object/dist/vocabulary/vcard.js
var VCARD = {
  fn: "http://www.w3.org/2006/vcard/ns#fn",
  Email: "http://www.w3.org/2006/vcard/ns#Email",
  email: "http://www.w3.org/2006/vcard/ns#email",
  hasEmail: "http://www.w3.org/2006/vcard/ns#hasEmail",
  hasMember: "http://www.w3.org/2006/vcard/ns#hasMember",
  hasValue: "http://www.w3.org/2006/vcard/ns#hasValue",
  hasPhoto: "http://www.w3.org/2006/vcard/ns#hasPhoto",
  tel: "http://www.w3.org/2006/vcard/ns#tel",
  hasTelephone: "http://www.w3.org/2006/vcard/ns#hasTelephone",
  title: "http://www.w3.org/2006/vcard/ns#title",
  hasUrl: "http://www.w3.org/2006/vcard/ns#hasUrl",
  organizationName: "http://www.w3.org/2006/vcard/ns#organization-name",
  phone: "http://www.w3.org/2006/vcard/ns#phone",
  role: "http://www.w3.org/2006/vcard/ns#role",
  value: "http://www.w3.org/2006/vcard/ns#value",
  telephoneType: "http://www.w3.org/2006/vcard/ns#TelephoneType"
};

// node_modules/@solid/object/dist/webid/Agent.js
var Agent = class extends TermWrapper {
  get vcardFn() {
    return OptionalFrom.subjectPredicate(this, VCARD.fn, LiteralAs.string);
  }
  get vcardHasUrl() {
    return OptionalFrom.subjectPredicate(this, VCARD.hasUrl, NamedNodeAs.string);
  }
  get organization() {
    return OptionalFrom.subjectPredicate(this, VCARD.organizationName, NamedNodeAs.string) ?? null;
  }
  get role() {
    return OptionalFrom.subjectPredicate(this, VCARD.role, NamedNodeAs.string) ?? null;
  }
  get title() {
    return OptionalFrom.subjectPredicate(this, VCARD.title, LiteralAs.string) ?? null;
  }
  get phone() {
    return this.hasTelephone?.value ?? null;
  }
  get hasTelephone() {
    return OptionalFrom.subjectPredicate(this, VCARD.hasTelephone, TermAs.instance(HasValue));
  }
  get foafName() {
    return OptionalFrom.subjectPredicate(this, FOAF.name, LiteralAs.string);
  }
  get name() {
    return this.vcardFn ?? this.foafName ?? this.value.split("/").pop()?.split("#")[0] ?? null;
  }
  get storageUrls() {
    return /* @__PURE__ */ new Set([...this.pimStorage, ...this.solidStorage]);
  }
  get foafHomepage() {
    return OptionalFrom.subjectPredicate(this, FOAF.homepage, LiteralAs.string);
  }
  get website() {
    return this.vcardHasUrl ?? this.foafHomepage ?? null;
  }
  get photoUrl() {
    return OptionalFrom.subjectPredicate(this, VCARD.hasPhoto, LiteralAs.string) ?? null;
  }
  get pimStorage() {
    return SetFrom.subjectPredicate(this, PIM.storage, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get solidStorage() {
    return SetFrom.subjectPredicate(this, SOLID.storage, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get oidcIssuer() {
    return SetFrom.subjectPredicate(this, SOLID.oidcIssuer, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get email() {
    return this.hasEmail?.value ?? null;
  }
  get hasEmail() {
    return OptionalFrom.subjectPredicate(this, VCARD.hasEmail, TermAs.instance(HasValue));
  }
  get knows() {
    return SetFrom.subjectPredicate(this, FOAF.knows, NamedNodeAs.string, NamedNodeFrom.string);
  }
};
var HasValue = class extends TermWrapper {
  get hasValue() {
    return OptionalFrom.subjectPredicate(this, VCARD.hasValue, NamedNodeAs.string);
  }
};

// src/components/profile-card.ts
var VCARD_ORG_NAME = "http://www.w3.org/2006/vcard/ns#organization-name";
var VCARD_ROLE = "http://www.w3.org/2006/vcard/ns#role";
var SCHEMA_NAME = "http://schema.org/name";
var IMG_PREDICATES = [
  "http://www.w3.org/2006/vcard/ns#hasPhoto",
  "http://xmlns.com/foaf/0.1/img",
  "http://xmlns.com/foaf/0.1/depiction",
  "http://schema.org/image"
];
var SITE_PREDICATES = [
  "http://www.w3.org/2006/vcard/ns#url",
  "http://xmlns.com/foaf/0.1/homepage",
  "http://schema.org/url"
];
var JeswrProfileCard = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: src };
  }
  renderReady(graph, baseUrl) {
    const fields = readProfileFields(graph, baseUrl);
    const hasProfileData = graph.getQuads(N3DataFactory_default.namedNode(baseUrl), null, null, null).length > 0;
    const { name, photo, website, org, role, issuer } = fields;
    if (!hasProfileData && !photo && !website && !org && !role && !issuer) {
      return b`<slot name="empty"><p part="empty">No profile to display.</p></slot>`;
    }
    const webId = safeHref(baseUrl);
    return b`
      <article part="card">
        ${photo ? b`<img part="photo" src=${photo} alt=${name ? `${name}'s avatar` : "avatar"} />` : null}
        <h2 part="name">${name ?? "(unnamed)"}</h2>
        ${org || role ? b`<p part="org">${[role, org].filter(Boolean).join(" \xB7 ")}</p>` : null}
        ${website ? b`<a part="website" href=${website} rel="noopener noreferrer">${website}</a>` : null}
        ${webId ? b`<a part="webid" href=${webId} rel="noopener noreferrer">${baseUrl}</a>` : null}
        ${issuer ? b`<small part="issuer">Issuer: ${issuer}</small>` : null}
      </article>
    `;
  }
};
function readProfileFields(graph, baseUrl) {
  const agent = new Agent(baseUrl, graph, N3DataFactory_default);
  return {
    name: tryRead(() => agent.name) ?? readValue(graph, baseUrl, [SCHEMA_NAME]) ?? void 0,
    photo: safeHref(tryRead(() => agent.photoUrl) ?? readValue(graph, baseUrl, IMG_PREDICATES)),
    website: safeHref(tryRead(() => agent.website) ?? readValue(graph, baseUrl, SITE_PREDICATES)),
    org: tryRead(() => agent.organization) ?? readValue(graph, baseUrl, [VCARD_ORG_NAME]),
    role: tryRead(() => agent.role) ?? tryRead(() => agent.title) ?? readValue(graph, baseUrl, [VCARD_ROLE]),
    issuer: safeHref(tryRead(() => [...agent.oidcIssuer][0]))
  };
}
function tryRead(read) {
  try {
    return read();
  } catch {
    return void 0;
  }
}
function readValue(graph, subject, predicates) {
  const s = N3DataFactory_default.namedNode(subject);
  for (const predicate of predicates) {
    for (const quad of graph.getQuads(s, N3DataFactory_default.namedNode(predicate), null, null)) {
      if (quad.object.termType === "Literal" || quad.object.termType === "NamedNode") {
        return quad.object.value;
      }
    }
  }
  return void 0;
}
if (!customElements.get("jeswr-profile-card")) {
  customElements.define("jeswr-profile-card", JeswrProfileCard);
}

// src/components/bookmark-list.ts
var JeswrBookmarkList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: result.url };
  }
  renderReady(graph) {
    const bookmarks = collectBookmarks(graph);
    if (bookmarks.length === 0) {
      return b`<slot name="empty"><p part="empty">No bookmarks.</p></slot>`;
    }
    return b`
      <ul part="list">
        ${bookmarks.map((b2) => this.#renderBookmark(b2))}
      </ul>
    `;
  }
  #renderBookmark(bookmark) {
    const href = safeHref(bookmark.url);
    const title = bookmark.title ?? bookmark.url ?? "(untitled bookmark)";
    const tags = [...bookmark.tags].sort();
    const meta = [];
    const created = formatDate(bookmark.created);
    if (created) meta.push(`Added: ${created}`);
    if (bookmark.archived) meta.push("Archived");
    return b`
      <li part="bookmark" data-archived=${bookmark.archived ? "true" : "false"}>
        ${href ? b`<a part="title" href=${href} rel="noopener noreferrer">${title}</a>` : b`<span part="title">${title}</span>`}
        ${bookmark.description ? b`<p>${bookmark.description}</p>` : null}
        ${tags.length > 0 ? b`<ul part="tags">
              ${tags.map((t) => b`<li>${t}</li>`)}
            </ul>` : null}
        ${meta.length > 0 ? b`<small part="meta">${meta.join(" \xB7 ")}</small>` : null}
      </li>
    `;
  }
};
function collectBookmarks(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== BOOKMARK_CLASS) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    const bookmark = new Bookmark(subject, graph, N3DataFactory_default);
    if (!safeHref(bookmark.url)) continue;
    out.push(bookmark);
  }
  return out;
}
if (!customElements.get("jeswr-bookmark-list")) {
  customElements.define("jeswr-bookmark-list", JeswrBookmarkList);
}

// src/components/collection.ts
var JeswrCollection = class extends AbstractReadElement {
  /** The children of the last listing (kept so render uses the listing, not a re-scan). */
  #children = [];
  static get properties() {
    return {
      ...AbstractReadElement.properties,
      typeIndex: { attribute: false }
    };
  }
  constructor() {
    super();
    this.typeIndex = void 0;
  }
  inputProps() {
    return [...BASE_INPUT_PROPS, "typeIndex"];
  }
  async loadFrom(controller, src, publicRead) {
    const listing = await controller.listContainer(src, publicRead ? { public: true } : {});
    this.#children = listing.children;
    return { graph: listing.dataset, baseUrl: listing.url };
  }
  renderReady() {
    const children = this.#children;
    if (children.length === 0) {
      return b`<slot name="empty"><p part="empty">Empty container.</p></slot>`;
    }
    const labels = typeIndexLabels(this.typeIndex);
    return b`
      <ul part="list">
        ${children.map((child) => this.#renderChild(child, labels))}
      </ul>
    `;
  }
  #renderChild(child, labels) {
    const href = safeHref(child.url);
    const label = labels.get(child.url);
    const text = displayName(child.url);
    return b`
      <li part="child" data-container=${child.isContainer ? "true" : "false"}>
        ${href ? b`<a part="link" href=${href} rel="noopener noreferrer">${text}</a>` : b`<span part="link">${text}</span>`}
        ${child.isContainer ? b`<span part="type">container</span>` : null}
        ${label ? b`<span part="type">${label}</span>` : null}
      </li>
    `;
  }
};
function typeIndexLabels(entries) {
  const m = /* @__PURE__ */ new Map();
  for (const e of entries ?? []) {
    if (!safeHref(e.instanceContainer)) continue;
    m.set(e.instanceContainer, `holds ${localName(e.class)}`);
  }
  return m;
}
function displayName(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.replace(/\/$/, "").split("/");
    const last = segments[segments.length - 1] || u.pathname || url;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}
function localName(iri) {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const cut = Math.max(hash, slash);
  return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri;
}
if (!customElements.get("jeswr-collection")) {
  customElements.define("jeswr-collection", JeswrCollection);
}

// src/resolver.ts
var RESOLVER_ENTRIES = [
  {
    targetClass: "http://www.w3.org/2005/01/wf/flow#Task",
    tagName: "jeswr-task-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#AddressBook",
    tagName: "jeswr-contact-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#Individual",
    tagName: "jeswr-contact-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 65
  },
  {
    targetClass: "https://w3id.org/jeswr/bookmark#Bookmark",
    tagName: "jeswr-bookmark-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70
  },
  // The generic LDP container listing — LOWEST priority so a typed container (an
  // AddressBook, a bookmarks container that ALSO types ldp:Container) renders with
  // its typed element, and only an UNtyped container falls through to the listing.
  {
    targetClass: LDP_CONTAINER,
    tagName: "jeswr-collection",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 10
  },
  {
    targetClass: LDP_BASIC_CONTAINER,
    tagName: "jeswr-collection",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 10
  },
  // ── Phase-2 EDIT-mode entries — the per-class editable forms. A consumer asks
  // the resolver for `{ mode: "edit" }` to get the FORM element for a class (e.g.
  // <solid-view mode="edit">). Same target classes as the view entries; the `mode`
  // filter selects between the read element + the form. Priorities mirror the view
  // entries so the same specificity ordering applies within the edit mode.
  {
    targetClass: "http://www.w3.org/2005/01/wf/flow#Task",
    tagName: "jeswr-task-form",
    importSpec: "@jeswr/solid-components",
    mode: "edit",
    priority: 70
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#Individual",
    tagName: "jeswr-contact-form",
    importSpec: "@jeswr/solid-components",
    mode: "edit",
    priority: 65
  },
  {
    targetClass: "https://w3id.org/jeswr/bookmark#Bookmark",
    tagName: "jeswr-bookmark-form",
    importSpec: "@jeswr/solid-components",
    mode: "edit",
    priority: 70
  }
];
var BY_CLASS = (() => {
  const m = /* @__PURE__ */ new Map();
  for (const e of RESOLVER_ENTRIES) if (!m.has(e.targetClass)) m.set(e.targetClass, e);
  return m;
})();
function resolveComponent(types, options = {}) {
  const wanted = new Set(types);
  let best;
  RESOLVER_ENTRIES.forEach((entry, index) => {
    if (!wanted.has(entry.targetClass)) return;
    if (options.mode && entry.mode !== options.mode) return;
    if (best === void 0 || entry.priority > best.entry.priority || // equal priority → keep the earlier registration (lower index), PM's tie-break.
    entry.priority === best.entry.priority && index < best.index) {
      best = { entry, index };
    }
  });
  return best?.entry;
}
function resolveComponentForClass(targetClass, options = {}) {
  const direct = BY_CLASS.get(targetClass);
  if (direct && (!options.mode || direct.mode === options.mode)) return direct;
  return resolveComponent([targetClass], options);
}
function collectTypes(dataset, subject) {
  const types = /* @__PURE__ */ new Set();
  for (const quad of iterateQuads(dataset)) {
    if (quad.predicate?.value !== RDF_TYPE) continue;
    if (quad.object?.termType !== "NamedNode") continue;
    const objectValue = quad.object.value;
    if (objectValue === void 0) continue;
    if (subject !== void 0 && quad.subject?.value !== subject) continue;
    types.add(objectValue);
  }
  return types;
}
function iterateQuads(dataset) {
  return dataset;
}

// src/components/solid-view.ts
var INPUT_PROPS = ["src", "classIri", "mode", "fetch", "publicFetch", "publicRead"];
var SolidView = class extends i {
  /** A supersede token so a stale probe never mounts over a newer one. */
  #token = 0;
  static properties = {
    src: {},
    classIri: { attribute: "class-iri" },
    mode: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    publicRead: { type: Boolean, attribute: "public-read" },
    status: { state: true },
    errorMessage: { state: true },
    resolved: { state: true }
  };
  constructor() {
    super();
    this.src = void 0;
    this.classIri = void 0;
    this.mode = "view";
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.publicRead = false;
    this.status = "idle";
    this.errorMessage = "";
    this.resolved = void 0;
  }
  /** Light DOM so the consuming app can `::part`/style the mounted child. */
  createRenderRoot() {
    return this;
  }
  willUpdate(changed) {
    const changedKeys = changed;
    if (INPUT_PROPS.some((k) => changedKeys.has(k))) void this.#resolve();
  }
  async #resolve() {
    const token = ++this.#token;
    const src = this.src;
    if (!src) {
      this.resolved = void 0;
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    if (this.classIri) {
      const entry = resolveComponentForClass(this.classIri, { mode: this.mode });
      this.#applyResolution(token, entry);
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    const seam = {
      ...this.fetch ? { fetch: this.fetch } : {},
      ...this.publicFetch ? { publicFetch: this.publicFetch } : {}
    };
    const controller = new DataController(seam);
    try {
      const result = await controller.read(src, this.publicRead ? { public: true } : {});
      if (token !== this.#token) return;
      const types = result.dataset ? collectTypes(result.dataset) : /* @__PURE__ */ new Set();
      const entry = resolveComponent(types, { mode: this.mode });
      this.#applyResolution(token, entry, types);
    } catch (error) {
      if (token !== this.#token) return;
      this.resolved = void 0;
      this.errorMessage = error instanceof DataControllerError ? error.message : error instanceof Error ? error.message : String(error);
      this.status = "error";
    }
  }
  /** Apply a resolution: lazy-load + mount the element, or fall back to unsupported. */
  #applyResolution(token, entry, types) {
    if (token !== this.#token) return;
    if (entry) {
      this.resolved = entry;
      this.status = "ready";
      void this.#ensureRegistered(entry.importSpec, token);
      return;
    }
    const isContainer = types !== void 0 && (types.has(LDP_CONTAINER) || types.has(LDP_BASIC_CONTAINER));
    if (isContainer) {
      this.resolved = resolveComponentForClass(LDP_CONTAINER, { mode: this.mode });
      this.status = this.resolved ? "ready" : "unsupported";
      return;
    }
    this.resolved = void 0;
    this.status = "unsupported";
  }
  /** Lazy-import the element's module so its `customElements.define` has run. */
  async #ensureRegistered(importSpec, token) {
    if (customElements.get(this.resolved?.tagName ?? "")) return;
    try {
      await import(
        /* @vite-ignore */
        importSpec
      );
    } catch (error) {
      if (token !== this.#token) return;
      this.errorMessage = `Failed to load the view module "${importSpec}": ${error instanceof Error ? error.message : String(error)}`;
      this.status = "error";
    }
  }
  render() {
    switch (this.status) {
      case "idle":
        return b`<slot name="empty"><p part="empty">No resource to display.</p></slot>`;
      case "loading":
        return b`<slot name="loading"><p part="loading">Loading…</p></slot>`;
      case "error":
        return b`<p part="error" role="alert">${this.errorMessage}</p>`;
      case "unsupported":
        return b`<slot name="unsupported"
          ><p part="unsupported">No typed view is available for this resource.</p></slot
        >`;
      default:
        return this.#renderResolved();
    }
  }
  /** Mount the resolved child element, forwarding the seam + src as properties. */
  #renderResolved() {
    const entry = this.resolved;
    if (!entry) return b`<p part="unsupported">No typed view is available.</p>`;
    return b`<div part="host" data-tag=${entry.tagName} data-src=${this.src ?? ""}></div>`;
  }
  /**
   * After render, (re)mount the resolved child with the seam + src wired as
   * properties. Done in `updated` (not the template) so the OBJECT props (`fetch`,
   * `publicFetch`) are set on the element instance, which a string attribute can't do.
   */
  updated(_changed) {
    const host = this.querySelector('[part="host"]');
    if (!host || !this.resolved) return;
    const tag = this.resolved.tagName;
    let child = host.firstElementChild;
    if (!child || child.tagName.toLowerCase() !== tag) {
      host.replaceChildren();
      child = document.createElement(tag);
      host.append(child);
    }
    const c = child;
    c.fetch = this.fetch;
    c.publicFetch = this.publicFetch;
    c.publicRead = this.publicRead;
    c.src = this.src;
  }
};
if (!customElements.get("solid-view")) {
  customElements.define("solid-view", SolidView);
}
export {
  AbstractFormElement,
  AbstractReadElement,
  AccessDeniedError,
  BOOKMARK_CLASS,
  DataController,
  DataControllerError,
  DataFormatError,
  DataWriter,
  EMPTY_SHAPES_MESSAGE,
  JeswrBookmarkForm,
  JeswrBookmarkList,
  JeswrCollection,
  JeswrContactForm,
  JeswrContactList,
  JeswrProfileCard,
  JeswrShaclForm,
  JeswrShaclView,
  JeswrTaskForm,
  JeswrTaskList,
  LDP_BASIC_CONTAINER,
  LDP_CONTAINER,
  NetworkError,
  NotFoundError,
  RDF_TYPE,
  RESOLVER_ENTRIES,
  SolidView,
  TASK_CLASS,
  UnconditionalOverwriteError,
  VALUES_SUBJECT_SENTINEL,
  VCARD_ADDRESS_BOOK,
  VCARD_INDIVIDUAL,
  WriteConflictError,
  WriteFailedError,
  WriteScopeError,
  classifyReadError,
  collectTypes,
  countTurtleQuads,
  defaultBaseFor,
  findEditedSubject,
  formatDate,
  neutraliseValuesTurtle,
  resolveAndHarden,
  resolveComponent,
  resolveComponentForClass,
  resolveGraphToTurtle,
  safeHref,
  safeMailto,
  safeTel,
  serializeTurtle,
  stripScheme
};
