// AUTHORED-BY Claude Opus 5.5
// Reading views: Architecture, Message, Layers and suites, Tests, Roadmap. Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var M = AX.model;
  var D = AX.diagram;
  var R = (AX.render = AX.render || {});

  // Small diagram helpers -------------------------------------------------------
  function box(x, y, w, h, label, sub, cls) {
    var s = D.rect(x, y, w, h, 'box ' + (cls || ''), 8);
    if (sub) s += D.text(x + w / 2, y + h / 2 - 3, label, 'lbl', 'middle') + D.text(x + w / 2, y + h / 2 + 13, sub, 'elbl', 'middle');
    else s += D.text(x + w / 2, y + h / 2 + 4, label, 'lbl', 'middle');
    return s;
  }
  function edge(d, label, lx, ly, cls, anchor) {
    var s = '<path d="' + d + '" class="edge ' + (cls || '') + '" marker-end="url(#' + (cls && cls.indexOf('accent') >= 0 ? 'ax-arrow-accent' : 'ax-arrow') + ')"/>';
    if (label) s += D.text(lx, ly, label, 'elbl', anchor || 'middle');
    return s;
  }
  function mini(w, h, label, body) {
    return '<svg class="mini" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' + D.DEFS + body + '</svg>';
  }
  function figure(svg, caption) {
    return '<figure class="arch-figure figwrap">' + svg + '<figcaption>' + esc(caption) + '</figcaption></figure>';
  }
  function riskChips(id) {
    var rs = AX.risksFor(id);
    if (!rs.length) return '';
    return '<div class="chips" aria-label="OWASP agentic risks">' + rs.map(function (r) {
      return '<a class="risk-chip" href="' + AX.buildHash('requirements', { select: r.id }) + '"><b>' + esc(r.id) + '</b>' + esc(r.name) + '</a>';
    }).join('') + '</div>';
  }
  // First matching event: real runs first, then fixtures, baseline configurations first.
  function firstEventWith(pred) {
    var order = AX.traces.slice().sort(function (a, b) {
      return (a.isFixture - b.isFixture) || (b.isBaseline - a.isBaseline) || (AX.scenarioIds.indexOf(a.scenario.id) - AX.scenarioIds.indexOf(b.scenario.id));
    });
    for (var k = 0; k < order.length; k++) {
      var t = order[k];
      for (var i = 0; i < t.events.length; i++) {
        var e = t.events[i];
        if (pred(e)) return AX.buildHash('explore', { scenario: t.scenario.id, config: t.configuration.id, step: e.step, seq: e.seq, level: 'checks' });
      }
    }
    return null;
  }

  // ================= Architecture =================
  R.architecture = function (root, p) {
    var sel = p.select || '';
    var svg = '<svg class="arch-svg" viewBox="-24 -4 590 ' + (D.HX + 8) + '" role="img" aria-label="One agent: principal on top, inbound gate with five checks, the core, outbound gate with six checks, and four stores underneath.">' + D.DEFS +
      D.agent({ name: 'Sam\'s agent', role: 'Personal agent, acts for Sam', principal: 'Sam', full: true, selectable: true, selected: sel, anchors: 'arch' }).svg + '</svg>';
    function qlist(list, title) {
      return '<div><p class="qhead">' + esc(title) + '</p><ol class="qlist">' + list.map(function (c) {
        return '<li id="arch-' + c.id + '" class="' + (sel === c.id ? 'selected sel' : '') + '"><button type="button" data-select="' + c.id + '"><span class="qn">' + c.n + '. ' + esc(c.name) + '</span><span class="qq">' + esc(c.question) + '</span></button></li>';
      }).join('') + '</ol></div>';
    }
    var h = '<div class="page arch">';
    h += '<header><p class="eyebrow">Reference architecture</p><h1>Two gates around a black box</h1>';
    h += '<p class="lede">Every agent in the walkthrough is built the same way. The core, usually a model, proposes. Ordinary code in two gates decides what comes in and what goes out, and writes every decision to a record. Select any part or check to read about it.</p></header>';
    h += '<div class="arch-grid">' + qlist(M.inboundChecks, 'Inbound checks, in order') + figure(svg, 'The core sees only admitted, labelled data and holds no keys. Messages enter on the left and leave on the right. The trust store keeps a short list of its own and looks the rest up outside the agent.') + qlist(M.outboundChecks, 'Outbound checks, in order') + '</div>';
    h += selPanel(sel);
    // Outcomes.
    h += '<h2>What each gate can decide</h2><div class="cards">';
    [['Inbound gate', M.inboundOutcomes, ['pass', 'ask', 'fail']], ['Outbound gate', M.outboundOutcomes, ['pass', 'askp', 'fail']]].forEach(function (g) {
      h += '<div class="card"><h3>' + esc(g[0]) + '</h3><ul class="outcome-list">' + g[1].map(function (o, k) {
        return '<li><span class="pill v-' + g[2][k] + '">' + esc(o.name) + '</span><span class="t">' + esc(o.summary) + '</span></li>';
      }).join('') + '</ul></div>';
    });
    h += '</div>';
    // Stores and transport.
    h += '<h2>The four stores, and transport</h2><div class="cards">';
    ['policies', 'memory', 'trust-store', 'record', 'transport'].forEach(function (id) {
      var part = AX.partById[id];
      if (!part) return;
      h += '<div class="card' + (sel === id ? ' sel' : '') + '" id="arch-' + id + '"><h3>' + esc(part.name) + '</h3><p>' + esc(part.summary) + '</p>' + riskChips(id) + '</div>';
    });
    h += '</div>';
    // Trust resolution.
    if (M.trustResolution) h += trustSection(M.trustResolution);
    // Variants.
    h += '<h2>Variants of the same design</h2>';
    h += variants();
    h += '</div>';
    root.innerHTML = h;
    root.querySelectorAll('[data-select]').forEach(function (n) {
      function pick(e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        var id = n.getAttribute('data-select');
        AX.go(AX.buildHash('architecture', { select: id === sel ? '' : id }));
      }
      n.addEventListener('click', pick);
      if (n.tagName !== 'BUTTON') n.addEventListener('keydown', pick);
    });
  };
  function selPanel(sel) {
    if (!sel) return '<div class="sel-panel" data-sel-target><p class="muted">Select a part of the agent, or a check, to see what it does and which risks it answers.</p></div>';
    var c = AX.checkById[sel];
    var part = AX.partById[sel];
    var h = '<div class="sel-panel" data-sel-target aria-live="polite">';
    if (c) {
      h += '<p class="eyebrow">' + esc(AX.partName(c.gate)) + ', check ' + c.n + '</p><h3>' + esc(c.name) + '</h3><p><strong>' + esc(c.question) + '</strong></p><p class="muted">' + esc(c.detail) + '</p>';
      var store = D.CONSULTS[c.id];
      if (store) h += '<p class="small muted">Reads the ' + esc(AX.partName(store).toLowerCase()) + '.</p>';
      var link = firstEventWith(function (e) { return e.kind === 'check' && e.check === c.id && e.verdict !== 'not-applicable'; });
      h += riskChips(c.id);
      if (link) h += '<p><a class="btn small" href="' + link + '">See it in the walkthrough</a></p>';
    } else if (part) {
      h += '<p class="eyebrow">Part</p><h3>' + esc(part.name) + '</h3><p>' + esc(part.summary) + '</p>' + riskChips(part.id);
      var pl = firstEventWith(function (e) { return e.part === part.id; });
      if (pl) h += '<p><a class="btn small" href="' + pl + '">See it in the walkthrough</a></p>';
    } else {
      h += '<p class="muted">Nothing called ' + esc(sel) + ' in the model.</p>';
    }
    return h + '</div>';
  }
  function trustSection(T) {
    var h = '<h2 id="trust-resolution">' + esc(T.title) + '</h2><div class="prose"><p>' + esc(T.text) + '</p></div>';
    h += '<div class="chain"><ol class="chain-levels" aria-label="Where a lookup goes, top to bottom">' + (T.levels || []).map(function (l) {
      return '<li><b>' + esc(l.name) + '</b><span>' + esc(l.text) + '</span></li>';
    }).join('') + '</ol>';
    if (T.example) h += AX.resolutionHtml(T.example, 'Worked example');
    return h + '</div>';
  }
  function variants() {
    var A = M;
    var out = '';
    function v(title, text, svg, cap) {
      out += '<section class="variant"><div class="prose"><h3>' + esc(title) + '</h3>' + text.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' + figure(svg, cap) + '</section>';
    }
    v('Solid as the persistence layer', [
      'The pod is where Sam and the agent meet. The agent\'s memory is a personal knowledge graph kept in sync with Sam\'s pod. What Sam writes there is ground truth from Sam, with metadata saying in which contexts it may be used.',
      'When another party will need data more than once, the outbound gate grants that party read access in the pod and sends a pointer with the terms, instead of a copy. The same six checks run on "change who can read this" as on "send this". Reading someone else\'s pod is an inbound message.',
    ], mini(540, 210, 'Sam writes to the pod; the agent keeps memory in sync; North Bank gets a pointer and reads with a grant.',
      box(10, 20, 110, 44, 'Sam') + box(205, 14, 130, 58, 'Sam\'s pod', 'ground truth', 'accent-box') +
      box(10, 140, 160, 50, 'Sam\'s agent', 'memory, outbound gate') + box(385, 140, 145, 50, 'North Bank', 'inbound gate') +
      edge('M120 42 H203', 'writes, with context', 162, 34) +
      edge('M95 140 C95 105 200 95 238 74', 'kept in sync', 118, 108, '', 'start') +
      edge('M170 165 H383', 'pointer and terms, no copy', 277, 157, 'accent') +
      edge('M455 140 C455 105 340 95 306 74', 'reads with the grant', 420, 108, 'dash', 'end')),
      'One copy, in the pod. Withdrawing the grant ends the sharing.');
    v('A knowledge-graph core', [
      'This opens the black box. Memory is a knowledge graph. Rules derive new facts, such as affordability, and each derived fact keeps a proof of which facts and rules produced it. The model handles language and planning. Ordinary code runs the routine steps.',
      'Because derived facts keep their proof, the outbound gate can work out the terms on a derived fact from the terms on its inputs.',
    ], mini(540, 200, 'Facts and rules derive affordability with a proof; the outbound gate derives its terms from the inputs.',
      D.rect(6, 10, 380, 180, 'box', 12, ' style="stroke-dasharray:5 4"') + D.text(18, 30, 'Agent core, opened', 'elbl') +
      box(20, 46, 120, 48, 'Memory graph', 'facts with labels') + box(20, 128, 120, 44, 'Rules') +
      box(200, 82, 170, 52, 'Affordability', 'derived, with its proof', 'accent-box') +
      box(170, 148, 90, 30, 'Model') + box(272, 148, 100, 30, 'Code') +
      edge('M140 70 C165 70 175 95 198 100', 'inputs', 168, 72) + edge('M140 150 C165 150 175 125 198 118', 'derive', 168, 156) +
      box(410, 82, 120, 52, 'Outbound gate', 'terms from inputs') + edge('M370 108 H408', '', 0, 0, 'accent')),
      'The model talks and plans; facts and rules decide what is true, and say why.');
    v('Asking for more', [
      'On the way out, the mandate sorts actions into three groups: act alone, ask first, never.',
      'On the way in, a receiver can answer with a challenge instead of yes or no: "this mandate was approved with a password; for this action I need a certified face check". The receiver decides which level of assurance it accepts for each kind of action.',
    ], mini(540, 220, 'The mandate sorts actions into act alone, ask first and never; a receiver can reply with a challenge for a stronger approval.',
      box(10, 88, 110, 44, 'Proposed action') +
      edge('M120 100 C140 100 140 40 158 40', '', 0, 0) + edge('M120 110 H158', '', 0, 0) + edge('M120 120 C140 120 140 180 158 180', '', 0, 0) +
      D.rect(160, 24, 100, 32, 'box', 8) + D.text(210, 45, 'Act alone', 'lbl ok', 'middle') +
      D.rect(160, 94, 100, 32, 'box', 8) + D.text(210, 115, 'Ask first', 'lbl', 'middle') +
      D.rect(160, 164, 100, 32, 'box', 8) + D.text(210, 185, 'Never', 'lbl no', 'middle') +
      D.text(330, 22, 'Sam\'s agent', 'lbl', 'middle') + D.text(480, 22, 'Harbour Bank', 'lbl', 'middle') +
      '<path d="M330 30 V210 M480 30 V210" class="edge dash" style="marker-end:none"/>' +
      edge('M332 56 H478', 'request, password approval', 405, 50) +
      edge('M478 96 H332', 'challenge: face check', 405, 90, 'accent') +
      edge('M332 136 H478', 'request and attestation', 405, 130) +
      D.text(480, 170, 'Admit', 'lbl ok', 'middle')),
      'Left: what the outbound gate does with a proposal. Right: a challenge for a stronger approval.');
    // Ways to establish trust: four questions, several answers each.
    var qs = [
      ['Is this agent acting for this person?', ['A key the person controls', 'An identity provider\'s attestation', 'A registry of agents']],
      ['Is this person my customer?', ['The identity provider links the identifiers', 'A signed claim on the person\'s identifier', 'A one-time sign-in at the bank']],
      ['Is this organization what it claims to be?', ['On the principal\'s own list', 'Listed on the sector register', 'A member of a federation']],
      ['Is this source an authority for this fact?', ['Rules per kind of claim: payroll for income, the bank for balances']],
    ];
    out += '<section class="variant" style="grid-template-columns:minmax(0,1fr)"><div class="prose"><h3>Ways to establish trust</h3><p>Four separate questions, each with several possible answers. A configuration picks one answer for each.</p></div><div class="trust-q">' +
      qs.map(function (q) { return '<div class="card"><h3>' + esc(q[0]) + '</h3><ul>' + q[1].map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>'; }).join('') + '</div></section>';
    v('Trusted indexes', [
      'Nobody should have to ask every lender in turn. Lenders publish signed product records. An index gathers them and keeps each record\'s provenance.',
      'The agent asks the index a question that carries no personal data, checks each record against the lender that signed it, and filters on its own side. The index is trusted only for coverage and freshness.',
    ], mini(540, 210, 'Lenders sign records; the index gathers them; the agent asks with no personal data and checks each record against its lender.',
      box(10, 20, 130, 40, 'North Bank') + box(10, 84, 130, 40, 'Lakeside Lending') + box(10, 148, 130, 40, 'Granite Mutual') +
      box(210, 74, 130, 60, 'Product index', 'keeps provenance', 'accent-box') + box(410, 74, 120, 60, 'Sam\'s agent', 'filters itself') +
      edge('M140 40 C175 40 180 90 208 96', '', 0, 0) + edge('M140 104 H208', 'signed records', 174, 98) + edge('M140 168 C175 168 180 118 208 112', '', 0, 0) +
      edge('M408 94 H342', 'no personal data', 375, 88) + edge('M342 116 H408', 'records', 375, 130, 'accent') +
      edge('M470 74 C470 8 120 0 80 18', 'checks each signature against its lender', 300, 14, 'dash')),
      'Trust the index for coverage and freshness; trust each record because its lender signed it.');
    v('Data quality and confidence', [
      'Trust is not only about who signed something. Each fact in memory carries how sure its source was, how fresh it is and how it was produced.',
      'The fitness check asks whether that is good enough for the task in hand, and which source wins when two disagree. Sam can share a health record marked "probably right, but take the doctor\'s word over mine".',
    ], mini(540, 180, 'Two income facts disagree; the fitness check picks the payroll figure.',
      box(10, 18, 190, 56, 'Income 52,000', 'self-reported, confidence low') + box(10, 104, 190, 56, 'Income 54,000', 'payroll, confidence high, 3 days old') +
      box(250, 60, 120, 56, 'Fitness check', 'which source wins?', 'accent-box') + box(410, 60, 120, 56, 'Uses 54,000', 'Sam\'s note kept, outranked') +
      edge('M200 46 C225 46 225 78 248 80', '', 0, 0) + edge('M200 132 C225 132 225 100 248 98', '', 0, 0) + edge('M370 88 H408', '', 0, 0, 'accent')),
      'Payroll outranks a self-reported income. The note stays in memory, marked as outranked.');
    return out;
  }

  // ================= Message =================
  var LAYER_TEXT = {
    carriage: 'Whatever carries the message: an HTTP request, an A2A or MCP call, an email, or a pointer to a resource in a pod. Nothing the gates decide depends on it, so the same message gets the same answers over any of them.',
    header: 'Who sent the message, to whom, in which conversation, what kind of message it is and when. It carries a one-time value and a time window. The sender\'s signature covers this layer and every layer below it. The integrity check reads it first, and nothing else runs if it fails.',
    authority: 'The mandate chain: the signed policy that says what this agent may do for its principal, and proof of how the principal approved it. The receiver follows it back to the person, and can ask for a stronger approval before it acts.',
    content: 'The request, the offer or the data itself, in the terms both sides agreed. It can be the original statements or an answer derived from them, and it can travel by value or by reference.',
    evidence: 'Statements signed by the authority for each claim, such as the bank\'s signature on a balance. For a derived answer it holds the record of the rule, the inputs and how the derivation is assured. The source check reads this layer.',
    terms: 'What the receiver may do with the content, for what purpose and for how long. The terms check reads them on the way in. They stay on the data as labels, and the outbound gate reads them before anything is passed on.',
    provenance: 'Where each part came from, which activity produced it, how fresh it is and how sure the source was. The fitness check uses it to decide whether the data is good enough, and the record keeps it.',
  };
  R.message = function (root, p) {
    var sel = p.select || '';
    var L = M.message.layers;
    var stack = '<div class="stack" aria-label="The layers of a verifiable message">';
    L.filter(function (l) { return !l.signed; }).forEach(function (l) {
      stack += '<a class="layer carriage' + (sel === l.id ? ' sel' : '') + '" href="' + AX.buildHash('message', { select: l.id }) + '"><div class="layer-head"><span class="ln">' + esc(l.name) + '</span><span class="lstate untrusted">' + esc(l.readBy) + '</span></div><p>' + esc(l.summary) + '</p></a>';
    });
    stack += '<div class="signed"><div class="signed-label">Inside the sender\'s signature</div>';
    L.filter(function (l) { return l.signed; }).forEach(function (l) {
      stack += '<a class="layer present' + (sel === l.id ? ' sel' : '') + '" href="' + AX.buildHash('message', { select: l.id }) + '"><div class="layer-head"><span class="ln">' + esc(l.name) + '</span><span class="lstate">Read by ' + esc(l.readBy) + '</span></div><p>' + esc(l.summary) + '</p></a>';
    });
    stack += '</div></div>';
    var paras = '<div class="layer-paras">' + L.map(function (l) {
      return '<article id="layer-' + l.id + '" class="' + (sel === l.id ? 'sel' : '') + '"><h3>' + esc(l.name) + '<span class="readby">' + (l.signed ? 'Read by ' + esc(l.readBy) : 'Never trusted') + '</span></h3><p>' + esc(LAYER_TEXT[l.id] || l.summary) + '</p>' + (AX.checkById[l.id] || AX.partById[l.id] ? '' : riskChips(l.id)) + '</article>';
    }).join('') + '</div>';
    var h = '<div class="page">';
    h += '<header><p class="eyebrow">' + esc(M.message.name) + '</p><h1>One message, the same layers, any carrier</h1><p class="lede">' + esc(M.message.summary) + '</p></header>';
    h += '<div class="msg-big">' + stack + paras + '</div>';
    h += '<h2>How content can travel</h2><div class="cards">';
    h += '<div class="card"><h3>By value</h3>' + mini(300, 96, 'The data travels inside the message.', box(6, 26, 90, 44, 'Sender') + D.rect(118, 30, 64, 36, 'box accent-box', 6) + D.text(150, 52, 'data', 'elbl', 'middle') + box(204, 26, 90, 44, 'Receiver') + edge('M96 48 H116', '', 0, 0) + edge('M182 48 H202', '', 0, 0)) + '<p>The data travels inside the message, signed with everything else. Simple, and the receiver keeps a copy.</p></div>';
    h += '<div class="card"><h3>By reference</h3>' + mini(300, 96, 'A pointer travels; the receiver reads from the pod with a grant.', box(6, 8, 90, 40, 'Sender') + box(204, 8, 90, 40, 'Receiver') + box(105, 58, 90, 34, 'Pod', '', 'accent-box') + edge('M96 28 H202', 'pointer and grant', 150, 22) + edge('M249 48 C249 70 220 75 197 75', '', 0, 0, 'dash')) + '<p>The sender grants read access in a pod and sends a pointer. Withdrawing the grant ends the sharing.</p></div>';
    h += '</div>';
    var DV = M.derivation;
    if (DV) {
      h += '<h2 id="derived">An answer instead of the records</h2><p class="lede">' + esc(DV.summary) + '</p>';
      h += '<div class="derive-fig">' + mini(640, 150, 'Source statements go through a rule and give a derived statement.',
        box(8, 10, 150, 38, 'Bank statement', 'signed by the bank') + box(8, 56, 150, 38, 'Bank statement', 'signed by another bank') + box(8, 102, 150, 38, 'Completeness', 'signed: these are all') +
        box(245, 50, 130, 50, 'Rule', 'a published query', 'accent-box') + box(462, 44, 170, 62, 'Derived statement', 'total deposit, with its record', 'accent-box') +
        edge('M158 29 C200 29 205 66 243 68', '', 0, 0) + edge('M158 75 H243', '', 0, 0) + edge('M158 121 C200 121 205 86 243 84', '', 0, 0) + edge('M375 75 H460', 'assured how?', 418, 68, 'accent')) + '</div>';
      h += '<p class="derive-idea">' + esc(DV.idea) + '</p>';
      h += '<h3 class="sub">Five ways to be assured the rule was applied honestly</h3><div class="table-wrap"><table class="grid"><thead><tr><th>Assurance</th><th>Who runs the rule</th><th>The receiver sees</th><th>Relied on besides the sources and the rule</th><th>How</th></tr></thead><tbody>' +
        DV.assurances.map(function (a) {
          return '<tr><th scope="row">' + esc(a.name) + (a.baseline ? ' <span class="tag-base">Baseline</span>' : '') + '<div class="mono-id">' + esc(a.id) + '</div></th><td>' + esc(a.runs) + '</td><td>' + esc(a.sees) + '</td><td>' + esc(a.relies) + '</td><td>' + esc(a.mechanism) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      h += '<div class="cards two"><div class="card"><h3>When a receiver accepts a derived claim</h3><ol class="plain">' + DV.acceptance.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol></div>' +
        '<div class="card"><h3>What a derivation cannot show</h3><ul class="plain">' + DV.limits.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
        '<p><a href="' + AX.buildHash('specs', { doc: DV.spec }) + '">Read the specification</a></p></div></div>';
    }
    h += '</div>';
    root.innerHTML = h;
  };

  // ================= Layers and suites =================
  var SPEC_DOC = {
    transport: '10-transport', 'data-access': '11-data-access', identity: '12-identity', meaning: '13-shared-meaning',
    authority: '14-delegated-authority', authenticity: '15-authenticity', trust: '16-trust-framework', reliance: '16b-reliance',
    'usage-control': '17-usage-control', commitments: '18-commitments', accountability: '19-accountability',
  };
  AX.specDocFor = function (layerId) {
    var id = SPEC_DOC[layerId];
    return id && (AX.data.specs || []).some(function (s) { return s.id === id; }) ? id : null;
  };
  function suiteStatus(layerId, suiteId) {
    var users = AX.traces.filter(function (t) { return t.layersFull[layerId] === suiteId; });
    // A way of settling counts only where a payment is actually made.
    var paid = AX.settlement && layerId === AX.settlement.id;
    if (paid) users = users.filter(function (t) { return AX.segmentRange(t, 'payment'); });
    var real = users.filter(function (t) { return !t.isFixture; });
    var list = real.length ? real : users;
    // Prefer a trace that differs from the baseline only here.
    var best = list.filter(function (t) {
      return Object.keys(AX.baselineLayers).every(function (k) { return k === layerId || t.layersFull[k] === AX.baselineLayers[k]; });
    })[0] || list[0];
    return { status: real.length ? 'runs' : (users.length ? 'fixture' : 'planned'), trace: best };
  }
  var STATUS_LABEL = { runs: 'Runs', fixture: 'Fixture only', planned: 'Planned' };
  R.layers = function (root, p) {
    var sel = p.select || '';
    var h = '<div class="page">';
    h += '<header><p class="eyebrow">Specification layers</p><h1>' + AX.orderedLayers.length + ' layers, one suite each</h1>';
    h += '<p class="lede">Each layer answers one question. A suite is one complete answer. A configuration picks one suite per layer, and the Explore view shows what changes when you switch one.</p></header>';
    h += '<p class="status-legend"><span><span class="suite runs" style="display:inline;padding:0 6px">Runs</span> a real trace uses it</span><span><span class="suite fixture" style="display:inline;padding:0 6px">Fixture only</span> only a development fixture uses it</span><span><span class="suite planned" style="display:inline;padding:0 6px">Planned</span> no trace yet</span></p>';
    if (M.maturityNote) h += '<p class="small muted prose">' + esc(M.maturityNote) + '</p>';
    h += '<div class="table-wrap"><table class="data"><thead><tr><th>Layer</th><th>Question</th><th>Suites</th></tr></thead><tbody>';
    var rows = [];
    AX.orderedLayers.forEach(function (l) {
      rows.push(l);
      if (AX.settlement && AX.settlement.partOf === l.id) rows.push(AX.settlement);
    });
    rows.forEach(function (l) {
      var rowSel = sel === l.id || sel.indexOf(l.id + '/') === 0;
      var doc = AX.specDocFor(l.id);
      h += '<tr id="layer-' + l.id + '" class="' + (sel === l.id ? 'sel' : '') + '">';
      var parent = l.partOf && AX.layerById[l.partOf];
      if (parent) doc = AX.specDocFor(parent.id);
      h += '<td><span class="layer-name">' + (parent ? '' : '<span class="layer-n">' + esc(AX.layerLabel(l)) + '</span>') + esc(l.name) + '</span>' + (parent ? '<div class="small muted">Part of ' + esc(parent.name.toLowerCase()) + ', chosen at the point of payment</div>' : '') + (doc ? '<div class="small"><a href="' + AX.buildHash('specs', { doc: doc }) + '">Read the spec</a></div>' : '') + '</td>';
      h += '<td style="min-width:200px;max-width:300px">' + esc(l.question) + (l.note ? '<div class="small muted" style="margin-top:6px">' + esc(l.note) + '</div>' : '') + '</td><td><div class="suites">';
      l.suites.forEach(function (s) {
        var st = suiteStatus(l.id, s.id);
        var isSel = sel === l.id + '/' + s.id || sel === s.id;
        var inner = '<span class="st">' + STATUS_LABEL[st.status] + (s.baseline ? ' <span class="base">baseline</span>' : '') + '</span><strong>' + esc(s.name) + '</strong>' +
          '<span class="small muted">' + esc(s.summary) + '</span>' +
          (s.maturity ? '<span class="small" style="margin-top:3px"><span class="tag">' + esc(s.maturity) + '</span></span>' : '') +
          (s.basis ? '<span class="small muted" style="font-size:11.5px">' + esc(s.basis) + '</span>' : '');
        var cls = 'suite ' + st.status + (isSel ? ' sel' : '');
        var at = { scenario: st.trace && st.trace.scenario.id, config: st.trace && st.trace.configuration.id };
        var seg = parent && st.trace && AX.segmentRange(st.trace, 'payment');
        if (seg) at.seq = st.trace.events[seg[0]].seq;
        if (st.trace) h += '<a class="' + cls + '" ' + (isSel ? 'data-sel-target ' : '') + 'href="' + AX.buildHash('explore', at) + '" title="Open in Explore">' + inner + '</a>';
        else h += '<div class="' + cls + '"' + (isSel ? ' data-sel-target' : '') + '>' + inner + '</div>';
      });
      h += '</div></td></tr>';
      void rowSel;
    });
    h += '</tbody></table></div></div>';
    root.innerHTML = h;
  };

  // ================= Tests =================
  R.tests = function (root) {
    var configs = [];
    AX.traces.forEach(function (t) { if (configs.indexOf(t.configuration.id) < 0) configs.push(t.configuration.id); });
    configs.sort(function (a, b) { return a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b); });
    var h = '<div class="page">';
    h += '<header><p class="eyebrow">Tests</p><h1>Every scenario in every configuration</h1><p class="lede">One cell per loaded trace: how many events it has, the checks by verdict, and whether it matches its committed outline.</p></header>';
    h += '<div class="table-wrap"><table class="data matrix"><thead><tr><th>Scenario</th>' + configs.map(function (c) {
      var t = AX.traces.filter(function (x) { return x.configuration.id === c; })[0];
      return '<th>' + esc(c) + '<div class="small muted" style="text-transform:none;letter-spacing:0;font-weight:500">' + esc(AX.configLabel(t)) + '</div></th>';
    }).join('') + '</tr></thead><tbody>';
    AX.scenarioIds.forEach(function (sc) {
      h += '<tr><td><strong>' + esc(AX.scenarioTitle(sc)) + '</strong><div class="small muted"><code>' + esc(sc) + '</code></div></td>';
      configs.forEach(function (c) {
        var t = AX.traceByKey[sc + '--' + c];
        if (!t) { h += '<td><span class="cell na-cell">Not run</span></td>'; return; }
        var counts = {};
        t.events.forEach(function (e) { if (e.kind === 'check') counts[e.verdict] = (counts[e.verdict] || 0) + 1; });
        var nChecks = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
        var exp = t.expected && typeof t.expected.matches === 'boolean' ? (t.expected.matches ? '<span class="tag ok">Matches outline</span>' : '<span class="tag bad">Departs from outline</span>') : '<span class="tag">Outline not checked</span>';
        var diff = Object.keys(AX.diffSteps(t)).length;
        h += '<td><a class="cell" href="' + AX.buildHash('explore', { scenario: sc, config: c }) + '" style="color:inherit;text-decoration:none">';
        h += '<span class="big">' + t.events.length + '<small>events, ' + nChecks + ' checks</small></span>';
        h += '<span class="counts">' + ['pass', 'not-applicable', 'ask-more', 'ask-principal', 'fail', 'indeterminate'].filter(function (v) { return counts[v]; }).map(function (v) {
          return '<span class="pill v-' + AX.verdicts[v].cls + '" title="' + esc(AX.verdicts[v].label) + '">' + AX.glyphSvg(v, 12) + counts[v] + '</span>';
        }).join('') + '</span>';
        h += '<span class="chips">' + exp + (t.isFixture ? '<span class="tag fx">Fixture</span>' : '') + (diff ? '<span class="tag">' + diff + ' steps differ from baseline</span>' : '') + '</span>';
        h += '</a></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="small muted" style="margin-top:12px">A trace file can carry <code>expected: { matches: true }</code> once the runtime compares it with its committed outline. Fixtures are not compared.</p></div>';
    root.innerHTML = h;
  };

  // ================= Roadmap =================
  var RM_STATUS = { done: 'Done', doing: 'Doing', next: 'Next', later: 'Later' };
  R.roadmap = function (root) {
    var rm = AX.data.roadmap;
    var h = '<div class="page">';
    h += '<header><p class="eyebrow">Roadmap' + (rm.updated ? ', updated ' + esc(rm.updated) : '') + '</p><h1>What gets built, in order</h1>' + (rm.note ? '<p class="lede">' + esc(rm.note) + '</p>' : '') + '</header>';
    (rm.phases || []).forEach(function (ph) {
      var items = ph.items || [];
      var done = items.filter(function (i) { return i.status === 'done'; }).length;
      h += '<section class="phase" id="phase-' + esc(ph.id) + '"><div class="phase-head"><h2>' + esc(ph.title) + '</h2><span class="progress"><span class="bar"><i style="width:' + (items.length ? Math.round((100 * done) / items.length) : 0) + '%"></i></span>' + done + ' of ' + items.length + ' done</span></div>';
      if (ph.goal) h += '<p class="phase-goal">' + esc(ph.goal) + '</p>';
      h += '<ul class="rm-items">' + items.map(function (it) {
        var title = it.link ? '<a href="' + esc(it.link) + '"' + (/^https?:/.test(it.link) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(it.title) + '</a>' : esc(it.title);
        return '<li><span><span class="status ' + esc(it.status) + '">' + esc(RM_STATUS[it.status] || it.status) + '</span></span><span class="rm-title">' + title + '</span><span class="rm-owner">' + esc(it.owner || '') + '</span><span class="rm-detail">' + esc(it.detail || '') + '</span></li>';
      }).join('') + '</ul></section>';
    });
    h += '</div>';
    root.innerHTML = h;
  };
})();
