// AUTHORED-BY Claude Opus 5.5
// Shared lookups, data indexes and helpers for the agent explorer. Classic script.
(function () {
  'use strict';
  var AX = (window.AX = window.AX || {});
  var D = window.AGENT_EXPLORER_DATA || { model: {}, traces: [], tours: [], scenarios: {} };
  var M = D.model;
  AX.data = D;
  AX.model = M;

  AX.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  AX.el = function (html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  AX.reducedMotion = function () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  AX.store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };

  // ---- Model lookups --------------------------------------------------------
  AX.partById = {};
  (M.parts || []).forEach(function (p) { AX.partById[p.id] = p; });
  AX.checkById = {};
  (M.inboundChecks || []).forEach(function (c) { c.gate = 'inbound-gate'; AX.checkById[c.id] = c; });
  (M.outboundChecks || []).forEach(function (c) { c.gate = 'outbound-gate'; AX.checkById[c.id] = c; });
  AX.layerById = {};
  AX.suiteIndex = {}; // suite id -> [{layer, suite}]
  (M.layers || []).forEach(function (l) {
    AX.layerById[l.id] = l;
    l.suites.forEach(function (s) {
      (AX.suiteIndex[s.id] = AX.suiteIndex[s.id] || []).push({ layer: l, suite: s });
    });
  });
  // The settlement choice: how money is moved and what shows that it was. It is part of the
  // commitments layer and is chosen at the point of payment, not in the configuration bar.
  AX.settlement = M.settlement || null;
  if (AX.settlement) {
    AX.layerById[AX.settlement.id] = AX.settlement;
    AX.settlement.suites.forEach(function (s) {
      (AX.suiteIndex[s.id] = AX.suiteIndex[s.id] || []).push({ layer: AX.settlement, suite: s });
    });
  }
  // The page that explains a layer: a choice that is part of another layer is explained there.
  AX.layerPage = function (l) { return (l && l.partOf) || (l && l.id); };
  AX.suite = function (layerId, suiteId) {
    var l = AX.layerById[layerId];
    if (!l) return null;
    for (var i = 0; i < l.suites.length; i++) if (l.suites[i].id === suiteId) return l.suites[i];
    return null;
  };
  AX.suiteName = function (layerId, suiteId) {
    var s = AX.suite(layerId, suiteId);
    return s ? s.name : suiteId;
  };
  AX.messageLayerById = {};
  ((M.message && M.message.layers) || []).forEach(function (l) { AX.messageLayerById[l.id] = l; });
  AX.partyById = {};
  (M.parties || []).forEach(function (p) { AX.partyById[p.id] = p; });
  AX.baselineLayers = {};
  (M.layers || []).forEach(function (l) {
    var b = l.suites.filter(function (s) { return s.baseline; })[0] || l.suites[0];
    AX.baselineLayers[l.id] = b.id;
  });
  if (AX.settlement) {
    AX.baselineLayers[AX.settlement.id] = (AX.settlement.suites.filter(function (s) { return s.baseline; })[0] || AX.settlement.suites[0]).id;
  }
  // A named stretch of a trace, marked on its first and last events. Where a run stops
  // before the stretch closes, it runs to the end.
  AX.segmentRange = function (t, name) {
    t._segments = t._segments || {};
    if (t._segments[name] !== undefined) return t._segments[name];
    var a = -1, b = -1;
    t.events.forEach(function (e, i) {
      if (e.segment === name && a < 0) a = i;
      if (e.segmentEnd === name) b = i;
    });
    if (a >= 0 && b < a) b = t.events.length - 1;
    return (t._segments[name] = a >= 0 ? [a, b] : null);
  };
  // Plumbing layers first, then the numbered ones.
  AX.orderedLayers = (M.layers || []).filter(function (l) { return l.group === 'plumbing'; })
    .concat((M.layers || []).filter(function (l) { return l.group !== 'plumbing'; }));
  // The badge a layer shows: its label from the model ("·" for plumbing, "1".."7", "4b").
  AX.layerLabel = function (l) {
    if (!l) return '';
    if (l.label != null) return String(l.label);
    return l.n != null ? String(l.n) : '';
  };
  AX.layerTitle = function (l) {
    var b = AX.layerLabel(l);
    return (b && b !== '·' ? b + ' ' : '') + l.name;
  };

  AX.verdicts = {
    pass: { label: 'Pass', cls: 'pass' },
    fail: { label: 'Fail', cls: 'fail' },
    'ask-more': { label: 'Ask for more', cls: 'ask' },
    'ask-principal': { label: 'Ask the principal', cls: 'askp' },
    'not-applicable': { label: 'Not applicable', cls: 'na' },
    indeterminate: { label: 'Indeterminate', cls: 'na' },
  };
  var outcomeNames = {};
  (M.inboundOutcomes || []).concat(M.outboundOutcomes || []).forEach(function (o) { outcomeNames[o.id] = o; });
  AX.outcomes = {
    ADMIT: { id: 'admit', cls: 'pass' },
    ASK_MORE: { id: 'ask-more', cls: 'ask' },
    REFUSE: { id: 'refuse', cls: 'fail' },
    GO: { id: 'go', cls: 'pass' },
    ASK_PRINCIPAL: { id: 'ask-principal', cls: 'askp' },
    STOP: { id: 'stop', cls: 'fail' },
  };
  AX.outcomeName = function (reason) {
    var o = AX.outcomes[reason];
    return o && outcomeNames[o.id] ? outcomeNames[o.id].name : reason;
  };
  AX.outcomeSummary = function (reason) {
    var o = AX.outcomes[reason];
    return o && outcomeNames[o.id] ? outcomeNames[o.id].summary : '';
  };
  AX.kindLabels = {
    'message-in': 'Message in',
    'message-out': 'Message out',
    check: 'Check',
    decision: 'Decision',
    store: 'Store',
    recall: 'Recall',
    propose: 'Proposal',
    'ask-principal': 'Ask the principal',
    'principal-reply': 'Principal',
    'principal-instruction': 'Principal',
    record: 'Record',
  };
  AX.partName = function (id) {
    return AX.partById[id] ? AX.partById[id].name : id;
  };

  // Verdict glyph, drawn (no font glyphs). Returns SVG markup centred on cx, cy.
  AX.glyph = function (verdict, cx, cy, r) {
    var v = AX.verdicts[verdict] || AX.verdicts.indeterminate;
    var s = r / 8;
    var p;
    if (verdict === 'pass') p = '<path d="M' + (cx - 3.6 * s) + ' ' + cy + ' l' + 2.6 * s + ' ' + 2.6 * s + ' l' + 4.8 * s + ' ' + -5.2 * s + '" class="g-mark"/>';
    else if (verdict === 'fail') p = '<path d="M' + (cx - 3 * s) + ' ' + (cy - 3 * s) + ' l' + 6 * s + ' ' + 6 * s + ' M' + (cx + 3 * s) + ' ' + (cy - 3 * s) + ' l' + -6 * s + ' ' + 6 * s + '" class="g-mark"/>';
    else if (verdict === 'ask-more') p = '<path d="M' + cx + ' ' + (cy - 3.6 * s) + ' v' + 7.2 * s + ' M' + (cx - 3.6 * s) + ' ' + cy + ' h' + 7.2 * s + '" class="g-mark"/>';
    else if (verdict === 'ask-principal') p = '<circle cx="' + cx + '" cy="' + (cy - 2 * s) + '" r="' + 1.9 * s + '" class="g-fill"/><path d="M' + (cx - 3.6 * s) + ' ' + (cy + 4 * s) + ' q' + 3.6 * s + ' ' + -5.5 * s + ' ' + 7.2 * s + ' 0" class="g-mark"/>';
    else p = '<path d="M' + (cx - 3 * s) + ' ' + cy + ' h' + 6 * s + '" class="g-mark"/>';
    return '<g class="glyph v-' + v.cls + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" class="g-bg"/>' + p + '</g>';
  };
  AX.glyphSvg = function (verdict, size) {
    size = size || 16;
    var h = size / 2;
    return '<svg class="glyph-inline" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' + AX.glyph(verdict, h, h, h - 0.5) + '</svg>';
  };
  AX.verdictPill = function (verdict) {
    var v = AX.verdicts[verdict] || AX.verdicts.indeterminate;
    return '<span class="pill v-' + v.cls + '">' + AX.glyphSvg(verdict, 14) + v.label + '</span>';
  };
  AX.outcomePill = function (reason) {
    var o = AX.outcomes[reason] || { cls: 'na' };
    return '<span class="pill v-' + o.cls + '">' + AX.esc(AX.outcomeName(reason)) + '</span>';
  };

  // Decision outcome: fixtures use reason ("ADMIT"); the runtime uses outcome ("admit").
  var OUT_BY_ID = { admit: 'ADMIT', 'ask-more': 'ASK_MORE', refuse: 'REFUSE', go: 'GO', 'ask-principal': 'ASK_PRINCIPAL', stop: 'STOP' };
  AX.outcomeKey = function (e) {
    if (e.outcome && OUT_BY_ID[e.outcome]) return OUT_BY_ID[e.outcome];
    if (e.reason && AX.outcomes[e.reason]) return e.reason;
    var byVerdict = e.part === 'inbound-gate'
      ? { pass: 'ADMIT', 'ask-more': 'ASK_MORE', fail: 'REFUSE' }
      : { pass: 'GO', 'ask-principal': 'ASK_PRINCIPAL', fail: 'STOP' };
    return byVerdict[e.verdict] || null;
  };
  // Packet ends: an agent id, or a display name such as "North Bank's agent".
  AX.packetEnds = function (t, e) {
    var ids = (t.agents || []).map(function (a) { return a.id; });
    function norm(s) { return String(s || '').toLowerCase().replace(/[’']/g, "'").trim(); }
    function resolve(v) {
      if (!v) return null;
      if (ids.indexOf(v) >= 0 || AX.partyById[v]) return v;
      var n = norm(v);
      var hit = null;
      (t.agents || []).concat(M.parties || []).some(function (a) {
        var an = norm(a.name);
        if (n === an || n === an + "'s agent" || n.replace(/'s agent$/, '') === an.replace(/'s agent$/, '')) { hit = a.id; return true; }
        return false;
      });
      return hit;
    }
    var from = resolve(e.packet.from);
    var to = resolve(e.packet.to);
    var others = ids.filter(function (id) { return id !== e.agent && (AX.partyById[id] || {}).kind !== 'person'; });
    if (!from && !to) {
      if (e.kind === 'message-out') { from = e.agent; to = others.length === 1 ? others[0] : null; }
      else { to = e.agent; from = others.length === 1 ? others[0] : null; }
    } else if (!from) { from = e.kind === 'message-out' ? e.agent : (others.length === 1 ? others[0] : null); }
    else if (!to) { to = e.kind === 'message-in' ? e.agent : (others.length === 1 ? others[0] : null); }
    return { from: from, to: to };
  };

  // ---- Traces --------------------------------------------------------------
  AX.traces = (D.traces || []).map(function (t) {
    var layers = Object.assign({}, AX.baselineLayers, (t.configuration && t.configuration.layers) || {});
    t.layersFull = layers;
    t.key = t.scenario.id + '--' + t.configuration.id;
    t.isFixture = !!(t.generated && t.generated.core === 'fixture');
    t.isBaseline = Object.keys(AX.baselineLayers).every(function (k) { return layers[k] === AX.baselineLayers[k]; });
    t.agents = t.agents || [];
    t.events.forEach(function (e, i) {
      if (e.kind === 'decision') e.outcomeKey = AX.outcomeKey(e);
      if (e.packet) {
        var ends = AX.packetEnds(t, e);
        e.pFrom = ends.from;
        e.pTo = ends.to;
      }
      e._i = i;
    });
    // Message events per packet, so the packet animation can split its path between them.
    var byPacket = {};
    t.events.forEach(function (e) { if (e.packet && /^message-/.test(e.kind)) (byPacket[e.packet.id] = byPacket[e.packet.id] || []).push(e); });
    Object.keys(byPacket).forEach(function (id) {
      var list = byPacket[id];
      list.forEach(function (e, k) { e.leg = [k / list.length, (k + 1) / list.length]; });
    });
    return t;
  });
  AX.traceByKey = {};
  AX.traces.forEach(function (t) { AX.traceByKey[t.key] = t; });
  AX.scenarioIds = [];
  AX.traces.forEach(function (t) { if (AX.scenarioIds.indexOf(t.scenario.id) < 0) AX.scenarioIds.push(t.scenario.id); });
  // Scenarios with a real run first, then the order of data/scenarios.json.
  var scenOrder = Object.keys(D.scenarios || {});
  function hasReal(id) { return AX.traces.some(function (t) { return t.scenario.id === id && !t.isFixture; }); }
  AX.scenarioIds.sort(function (a, b) {
    var ra = hasReal(a) ? 0 : 1;
    var rb = hasReal(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    var ia = scenOrder.indexOf(a);
    var ib = scenOrder.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  AX.scenarioHasReal = hasReal;
  AX.tracesFor = function (scenarioId) {
    return AX.traces.filter(function (t) { return t.scenario.id === scenarioId; });
  };
  AX.baselineTrace = function (scenarioId) {
    var list = AX.tracesFor(scenarioId);
    return list.filter(function (t) { return t.isBaseline && !t.isFixture; })[0] || list.filter(function (t) { return t.isBaseline; })[0] || list[0] || null;
  };
  AX.sameLayers = function (a, b) {
    return Object.keys(AX.baselineLayers).every(function (k) { return a[k] === b[k]; });
  };
  AX.findTraceByLayers = function (scenarioId, layers) {
    return AX.tracesFor(scenarioId).filter(function (t) { return AX.sameLayers(t.layersFull, layers); })[0] || null;
  };
  AX.scenarioMeta = function (id) {
    return (D.scenarios && D.scenarios[id]) || {};
  };
  AX.scenarioTitle = function (id) {
    var t = AX.tracesFor(id)[0];
    return t ? t.scenario.title : id;
  };
  // Step titles: the trace's own scenario.steps, then data/scenarios.json, then "Step n".
  AX.stepTitle = function (scenarioId, n, trace) {
    var own = trace && trace.scenario && trace.scenario.steps;
    if (own && own[String(n)]) return own[String(n)];
    var m = AX.scenarioMeta(scenarioId);
    return (m.steps && m.steps[String(n)]) || 'Step ' + n;
  };
  AX.configLabel = function (t) {
    if (t.isBaseline) return 'Baseline';
    var diffs = Object.keys(AX.baselineLayers).filter(function (k) { return t.layersFull[k] !== AX.baselineLayers[k]; });
    return diffs.map(function (k) { return AX.layerById[k].name + ': ' + AX.suiteName(k, t.layersFull[k]); }).join(', ');
  };
  // Expected outline (brief 02): check, decision, message-* and ask-principal events.
  AX.outlineOf = function (events) {
    return events
      .filter(function (e) { return /^(check|decision|message-in|message-out|ask-principal)$/.test(e.kind); })
      .map(function (e) { return [e.agent, e.part, e.kind, e.check || '', e.verdict || '', e.reason || ''].join('|'); })
      .join('\n');
  };
  // Steps as runs of consecutive events with the same step number, in trace order. Gaps in the
  // numbering leave no empty slots; a step number that comes back later starts a new run.
  AX.stepsOf = function (t) {
    if (t._steps) return t._steps;
    var steps = [];
    var cur = null;
    t.events.forEach(function (e, i) {
      if (!cur || cur.n !== e.step) { cur = { n: e.step, first: i, last: i, events: [] }; steps.push(cur); }
      cur.last = i;
      cur.events.push(e);
    });
    t._steps = steps;
    return steps;
  };
  AX.stepAt = function (t, i) {
    var st = AX.stepsOf(t);
    for (var k = 0; k < st.length; k++) if (i >= st[k].first && i <= st[k].last) return st[k];
    return st[st.length - 1];
  };
  // Steps whose outline differs from the scenario's baseline trace.
  AX.diffSteps = function (t) {
    if (t._diff) return t._diff;
    var base = AX.baselineTrace(t.scenario.id);
    var out = {};
    if (base && base !== t) {
      var group = function (tr) {
        var g = {};
        tr.events.forEach(function (e) { (g[e.step] = g[e.step] || []).push(e); });
        Object.keys(g).forEach(function (k) { g[k] = AX.outlineOf(g[k]); });
        return g;
      };
      var bs = group(base);
      var ts = group(t);
      Object.keys(ts).forEach(function (k) { if (bs[k] !== ts[k]) out[k] = true; });
    }
    t._diff = out;
    return out;
  };
  // Gate passes: which checks a gate has run, per agent, for any event index.
  AX.passesOf = function (t) {
    if (t._passes) return t._passes;
    var passes = {};
    t.events.forEach(function (e, i) {
      if (e.part !== 'inbound-gate' && e.part !== 'outbound-gate') return;
      var key = e.agent + '|' + e.part;
      var list = (passes[key] = passes[key] || []);
      var cur = list[list.length - 1];
      function fresh() { cur = { start: i, end: i, checks: [], decision: null, closed: false }; list.push(cur); }
      if (e.kind === 'message-in') { fresh(); return; }
      if (e.kind === 'check') {
        if (!cur || cur.closed) fresh();
        cur.checks.push({ i: i, check: e.check, verdict: e.verdict });
        cur.end = i;
      } else if (e.kind === 'decision') {
        if (!cur || cur.closed) fresh();
        cur.decision = { i: i, reason: e.outcomeKey };
        cur.end = i;
        if (e.outcomeKey !== 'ASK_PRINCIPAL') cur.closed = true;
      }
    });
    t._passes = passes;
    return passes;
  };
  AX.gateAt = function (t, agent, gate, i) {
    var list = AX.passesOf(t)[agent + '|' + gate] || [];
    var pass = null;
    for (var k = 0; k < list.length; k++) if (list[k].start <= i) pass = list[k];
    var res = { checks: {}, outcome: null, idle: true };
    if (!pass) return res;
    pass.checks.forEach(function (c) { if (c.i <= i) res.checks[c.check] = c.verdict; });
    if (pass.decision && pass.decision.i <= i) res.outcome = pass.decision.reason;
    res.idle = !(i >= pass.start && i <= pass.end);
    return res;
  };

  // ---- Hash state ----------------------------------------------------------
  // The page keeps its own copy of the hash and routes from that. The address bar is only a
  // mirror: some hosts (a framed viewer) pass nothing but a plain "#name" in either direction,
  // so navigation must not depend on the browser accepting or reporting a hash change.
  AX.hash = { cur: location.hash || '', framed: (function () { try { return window.self !== window.top; } catch (e) { return true; } })() };
  function mirror(h, push) {
    // Framed: mirror the view name only. Top level: mirror the whole state so links can be shared.
    var shown = AX.hash.framed ? '#' + (AX.parseHash(h).view || 'explore') : h;
    try {
      if (location.hash === shown) return;
      if (push) history.pushState(null, '', shown); else history.replaceState(null, '', shown);
    } catch (e) { /* the page still works from AX.hash.cur */ }
  }
  // Navigate: used by every link and control. opts.replace keeps the back stack unchanged.
  AX.go = function (h, opts) {
    if (h.charAt(0) !== '#') h = '#' + h;
    var same = AX.hash.cur === h;
    AX.hash.cur = h;
    mirror(h, !(opts && opts.replace) && !same);
    if (!(opts && opts.silent) && AX.route) AX.route();
  };
  AX.parseHash = function (hash) {
    var h = (hash == null ? AX.hash.cur : hash).replace(/^#\/?/, '');
    var q = h.indexOf('?');
    var view = (q < 0 ? h : h.slice(0, q)) || 'explore';
    var params = {};
    if (q >= 0) {
      h.slice(q + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        params[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join('=') || '');
      });
    }
    return { view: view, params: params };
  };
  AX.buildHash = function (view, params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '' || v === false) return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v === true ? '1' : v));
    });
    return '#/' + view + (parts.length ? '?' + parts.join('&') : '');
  };

  // ---- OWASP lookups (model.requirements) -----------------------------------
  var R = M.requirements || {};
  AX.requirements = R;
  AX.risksFor = function (id) {
    return (R.owaspAgentic || []).filter(function (r) { return (r.where || []).indexOf(id) >= 0; });
  };
  // Resolve an id that may be a part, a check, a message layer, a spec layer or a suite.
  AX.resolveId = function (id) {
    if (AX.partById[id]) return { kind: 'part', name: AX.partById[id].name, href: AX.buildHash('architecture', { select: id }) };
    if (AX.checkById[id]) {
      var c = AX.checkById[id];
      return { kind: 'check', name: c.name + ' check', href: AX.buildHash('architecture', { select: id }) };
    }
    if (AX.messageLayerById[id]) return { kind: 'message layer', name: AX.messageLayerById[id].name, href: AX.buildHash('message', { select: id }) };
    if (AX.layerById[id]) return { kind: 'layer', name: AX.layerById[id].name, href: AX.buildHash('layers', { select: AX.layerPage(AX.layerById[id]) }) };
    if (AX.suiteIndex[id]) {
      var s = AX.suiteIndex[id][0];
      return { kind: 'suite', name: s.suite.name, href: AX.buildHash('layers', { select: s.layer.partOf ? s.layer.partOf : s.layer.id + '/' + id }) };
    }
    return null;
  };
})();

// Trust lookups: "How this was looked up" (optional `resolution` on a check event).
(function () {
  'use strict';
  var AX = window.AX;
  var KIND = { 'own-list': 'Own list', root: 'Root', register: 'Register', federation: 'Federation', international: 'International' };
  AX.resolutionKinds = KIND;
  AX.resolutionHtml = function (r, title) {
    var esc = AX.esc;
    var h = '<section class="resolution" data-anchor="inspector.resolution"><h4>' + esc(title || 'How this was looked up') + '</h4>';
    if (r.question) h += '<p class="res-q">' + esc(r.question) + '</p>';
    h += '<ol class="res-path">';
    (r.path || []).forEach(function (p) {
      h += '<li class="res-step k-' + esc(p.kind) + '"><span class="res-kind">' + esc(KIND[p.kind] || p.kind) + '</span><span class="res-at">' + esc(p.at) + '</span><span class="res-says">' + esc(p.says) + '</span></li>';
    });
    h += '</ol>';
    if (r.answer) h += '<p class="res-a"><span>Answer</span>' + esc(r.answer) + '</p>';
    return h + '</section>';
  };
})();
