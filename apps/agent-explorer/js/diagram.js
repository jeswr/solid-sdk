// AUTHORED-BY Claude Opus 5.5
// SVG drawing for the reference architecture: one agent, a service box, and the stage.
// The same code draws the Explore stage and the Architecture view. Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var M = AX.model;

  var W = 500; // agent width
  var G = { titleH: 34, pTop: 42, pH: 30, gTop: 86, gH: 262, sTop: 362, sH: 44 };
  var H = G.sTop + G.sH; // 406
  var HX = H + 24; // with the trust lookup line below the stores
  var GATE_W = 205;
  var CORE_X = 217;
  var CORE_W = 66;
  var OUT_X = 295;
  var STORES = ['policies', 'memory', 'trust-store', 'record'];
  // Which store each check reads (from the check details in model.json).
  var CONSULTS = {
    integrity: 'trust-store', source: 'trust-store', authority: 'trust-store', terms: 'policies', fitness: 'memory',
    mandate: 'policies', recipient: 'trust-store', disclosure: 'memory', 'data-terms': 'memory',
    'limits-approval': 'policies', evidence: 'record',
  };

  function text(x, y, s, cls, anchor) {
    return '<text x="' + x + '" y="' + y + '" class="' + (cls || '') + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(s) + '</text>';
  }
  function rect(x, y, w, h, cls, rx, extra) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx == null ? 8 : rx) + '" class="' + (cls || '') + '"' + (extra || '') + '/>';
  }
  function attrSel(o, id) {
    return o.selectable ? ' data-select="' + id + '" tabindex="0" role="button" aria-label="' + esc(AX.partName(id) || id) + '"' : '';
  }
  function anchor(o, name) {
    return o.anchors ? ' data-anchor="' + o.anchors + '.' + name + '"' : '';
  }

  function gate(o, x, y, kind) {
    var inbound = kind === 'inbound-gate';
    var checks = inbound ? M.inboundChecks : M.outboundChecks;
    var st = (o.gates && o.gates[kind]) || { checks: {}, outcome: null, idle: true };
    var lit = o.lit && o.lit.part === kind;
    var headH = 30;
    var outH = 32;
    var rowH = (G.gH - headH - outH) / checks.length;
    var cls = 'gate' + (lit ? ' lit' : '') + (st.idle ? ' idle' : '') + (o.selected === kind ? ' selected' : '');
    var s = '<g class="' + cls + '"' + anchor(o, kind) + '>';
    s += '<g' + attrSel(o, kind) + '>' + rect(x, y, GATE_W, G.gH, 'box gate-box') + text(x + 12, y + 20, AX.partName(kind), 'h-gate') + '</g>';
    checks.forEach(function (c, k) {
      var ry = y + headH + k * rowH;
      var v = st.checks[c.id];
      var rowLit = o.lit && o.lit.check === c.id && o.lit.part === kind;
      var vc = v ? (AX.verdicts[v] || {}).cls : '';
      var rcls = 'row' + (rowLit ? ' lit' : '') + (v ? ' has-v v-' + vc : '') + (o.selected === c.id ? ' selected' : '');
      s += '<g class="' + rcls + '"' + attrSel(o, c.id) + (rowLit && o.anchors ? ' data-anchor="' + o.anchors + '.check"' : '') + '>';
      s += '<title>' + esc(c.n + '. ' + c.name + ': ' + c.question) + '</title>';
      s += rect(x + 4, ry + 1, GATE_W - 8, rowH - 2, 'row-bg', 6);
      s += '<circle cx="' + (x + 18) + '" cy="' + (ry + rowH / 2) + '" r="9" class="num-bg"/>' + text(x + 18, ry + rowH / 2 + 4, String(c.n), 'num', 'middle');
      var two = rowH >= 32 && !o.compact;
      s += text(x + 34, ry + (two ? rowH / 2 - 2 : rowH / 2 + 4), c.name, 'row-name');
      if (two) s += text(x + 34, ry + rowH / 2 + 11, c.short, 'row-short');
      if (v) s += AX.glyph(v, x + GATE_W - 16, ry + rowH / 2, 8);
      s += '</g>';
    });
    // Outcome strip.
    var oy = y + G.gH - outH;
    s += '<line x1="' + (x + 8) + '" x2="' + (x + GATE_W - 8) + '" y1="' + oy + '" y2="' + oy + '" class="rule"/>';
    if (st.outcome) {
      var oc = (AX.outcomes[st.outcome] || { cls: 'na' }).cls;
      s += text(x + 12, oy + 20, 'Outcome', 'row-short');
      var label = AX.outcomeName(st.outcome);
      var pw = Math.max(44, label.length * 6.4 + 18);
      s += '<g class="outcome v-' + oc + '">' + rect(x + GATE_W - 10 - pw, oy + 6, pw, 20, 'pill-bg', 10) + text(x + GATE_W - 10 - pw / 2, oy + 20, label, 'pill-text', 'middle') + '</g>';
    } else {
      var names = (inbound ? M.inboundOutcomes : M.outboundOutcomes).map(function (x) { return x.name; });
      s += text(x + 12, oy + 20, o.full ? names.join(', ') : 'No outcome yet', 'row-short muted');
    }
    s += '</g>';
    return s;
  }

  // One agent drawn in full. Returns { svg, inPort, outPort }.
  function agent(o) {
    var x = o.x || 0;
    var y = o.y || 0;
    var k = o.scale || 1;
    var s = '<g class="agent' + (o.acting ? ' acting' : '') + '" transform="translate(' + x + ' ' + y + ')' + (k !== 1 ? ' scale(' + k + ')' : '') + '"' + (o.anchors ? ' data-anchor="' + o.anchors + '.agent"' : '') + '>';
    // Title.
    s += text(0, 15, o.name, 'h-agent');
    s += text(0, 31, o.role || '', 'sub');
    if (o.badge) {
      var bw = o.badge.length * 6.6 + 20;
      s += '<g class="badge' + (o.acting ? ' on' : '') + '">' + rect(W - bw, 2, bw, 22, 'badge-bg', 11) + text(W - bw / 2, 17, o.badge, 'badge-text', 'middle') + '</g>';
    }
    // Principal bar.
    var pl = o.lit && o.lit.part === 'principal';
    s += '<g class="part principal' + (pl ? ' lit' : '') + (o.selected === 'principal' ? ' selected' : '') + '"' + anchor(o, 'principal') + attrSel(o, 'principal') + '>';
    s += rect(0, G.pTop, W, G.pH, 'box', 8) + text(12, G.pTop + 20, 'Principal', 'h-part') + text(80, G.pTop + 20, o.principal || '', 'sub-strong');
    s += text(W - 12, G.pTop + 20, 'Signs the mandate, approves, can stop', 'sub', 'end') + '</g>';
    // Arrows from principal to gates (mandate) are implied; draw the internal flow.
    var midY = G.gTop + G.gH / 2;
    s += gate(o, 0, G.gTop, 'inbound-gate');
    s += gate(o, OUT_X, G.gTop, 'outbound-gate');
    // Core.
    var cl = o.lit && o.lit.part === 'core';
    s += '<g class="part core' + (cl ? ' lit' : '') + (o.selected === 'core' ? ' selected' : '') + '"' + anchor(o, 'core') + attrSel(o, 'core') + '>';
    s += rect(CORE_X, G.gTop, CORE_W, G.gH, 'box core-box', 8);
    var ccx = CORE_X + CORE_W / 2;
    s += '<g transform="rotate(-90 ' + ccx + ' ' + midY + ')">';
    s += text(ccx, midY - 6, 'Agent core', 'h-core', 'middle');
    s += text(ccx, midY + 14, 'Black box. No keys. Proposes only.', 'sub', 'middle');
    s += '</g>';
    s += '</g>';
    // Internal arrows: gate -> core -> gate.
    s += '<path d="M' + GATE_W + ' ' + midY + ' H' + (CORE_X - 1) + '" class="flow" marker-end="url(#ax-arrow)"/>';
    s += '<path d="M' + (CORE_X + CORE_W) + ' ' + midY + ' H' + (OUT_X - 1) + '" class="flow" marker-end="url(#ax-arrow)"/>';
    // Ports.
    s += '<path d="M-16 ' + midY + ' H-1" class="flow port" marker-end="url(#ax-arrow)"/>';
    s += '<path d="M' + W + ' ' + midY + ' H' + (W + 15) + '" class="flow port" marker-end="url(#ax-arrow)"/>';
    // Stores.
    var sw = (W - 3 * 10) / 4;
    var consult = o.lit && o.lit.check ? CONSULTS[o.lit.check] : null;
    STORES.forEach(function (id, k) {
      var sx = k * (sw + 10);
      var lit = o.lit && ((o.lit.part === id) || (id === 'memory' && o.lit.part === 'memory') || (id === 'record' && o.lit.part === 'record'));
      var c = 'part store' + (lit ? ' lit pulse' : '') + (consult === id ? ' consult' : '') + (o.selected === id ? ' selected' : '');
      if (id === 'trust-store') {
        // The trust store is a short local list plus a lookup that leads out of the agent.
        var rl = o.lit && o.lit.resolution;
        s += '<g class="' + c + (rl ? ' consult' : '') + '"' + anchor(o, id) + attrSel(o, id) + '>' + rect(sx, G.sTop, sw, G.sH, 'box', 8) +
          text(sx + sw / 2, G.sTop + 19, AX.partName(id), 'h-store', 'middle') + text(sx + sw / 2, G.sTop + 34, 'own list', 'sub', 'middle') + '</g>';
        var cx = sx + sw / 2;
        var ly = H + 16;
        s += '<g class="trust-link' + (rl ? ' lit' : '') + '"' + anchor(o, 'trust-chain') + '>';
        s += '<path d="M' + cx + ' ' + (G.sTop + G.sH) + ' V' + ly + ' H' + (cx + 18) + '" class="trust-line"/>';
        s += '<circle cx="' + (cx + 22) + '" cy="' + ly + '" r="4" class="trust-node"/><path d="M' + (cx + 26) + ' ' + ly + ' H' + (cx + 36) + '" class="trust-line"/><circle cx="' + (cx + 40) + '" cy="' + ly + '" r="4" class="trust-node"/>';
        s += text(cx + 50, ly + 4, 'Lookup: root, then register', 'sub') + '</g>';
      } else {
        s += '<g class="' + c + '"' + anchor(o, id) + attrSel(o, id) + '>' + rect(sx, G.sTop, sw, G.sH, 'box', 8) + text(sx + sw / 2, G.sTop + 27, AX.partName(id), 'h-store', 'middle') + '</g>';
      }
    });
    s += '</g>';
    return { svg: s, inPort: { x: x, y: y + midY * k }, outPort: { x: x + W * k, y: y + midY * k } };
  }

  // A service that is not an agent: a simple box.
  function service(o) {
    var x = o.x || 0;
    var y = o.y || 0;
    var bw = 280;
    var bh = 120;
    var bx = (W - bw) / 2;
    var by = G.gTop + (G.gH - bh) / 2;
    var lit = !!o.active;
    var k = o.scale || 1;
    var s = '<g class="agent service' + (lit ? ' acting' : '') + '" transform="translate(' + x + ' ' + y + ')' + (k !== 1 ? ' scale(' + k + ')' : '') + '">';
    s += text(0, 15, o.name, 'h-agent') + text(0, 31, o.role || '', 'sub');
    if (o.badge) {
      var bwid = o.badge.length * 6.6 + 20;
      s += '<g class="badge">' + rect(W - bwid, 2, bwid, 22, 'badge-bg', 11) + text(W - bwid / 2, 17, o.badge, 'badge-text', 'middle') + '</g>';
    }
    s += '<g class="part svc' + (lit ? ' lit' : '') + '">' + rect(bx, by, bw, bh, 'box', 10);
    s += text(W / 2, by + 50, o.name, 'h-part', 'middle') + text(W / 2, by + 72, 'Service, not an agent', 'sub', 'middle') + '</g>';
    var midY = G.gTop + G.gH / 2;
    s += '<path d="M' + (bx - 16) + ' ' + midY + ' H' + (bx - 1) + '" class="flow port" marker-end="url(#ax-arrow)"/>';
    s += '<path d="M' + (bx + bw) + ' ' + midY + ' H' + (bx + bw + 15) + '" class="flow port" marker-end="url(#ax-arrow)"/>';
    s += '</g>';
    return { svg: s, inPort: { x: x + bx * k, y: y + midY * k }, outPort: { x: x + (bx + bw) * k, y: y + midY * k } };
  }

  var DEFS = '<defs><marker id="ax-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arrowhead"/></marker>' +
    '<marker id="ax-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="arrowhead accent"/></marker></defs>';

  // The Explore stage. o = { left, right, layout: 'wide'|'tall', lane: {suite, lit}, message: {from, to, kind, active} }
  function stage(o) {
    var tall = o.layout === 'tall';
    var k = (o.right && o.right.scale) || 1;
    var midY = G.gTop + G.gH / 2;
    var posL = { x: 0, y: 0 };
    var posR = tall ? { x: (W - W * k) / 2, y: HX + 64 } : { x: W + 70, y: midY * (1 - k) };
    var laneY = HX + 26;
    function draw(p, pos) {
      if (!p) return null;
      var opts = Object.assign({}, p, pos);
      return p.kind === 'service' ? service(opts) : agent(opts);
    }
    var L = draw(o.left, posL);
    var R = draw(o.right, posR);
    var vw = tall ? W + 56 : W + 70 + W * k + 56;
    var vh = tall ? HX + 64 + HX * k + 8 : HX + 56;
    var s = '<svg class="stage-svg" viewBox="-28 -4 ' + vw + ' ' + vh + '" role="img" aria-label="' + esc(o.label || 'Two agents and the message between them') + '">' + DEFS;
    // Transport lane.
    var laneW = vw - 12;
    s += '<g class="lane' + (o.lane && o.lane.lit ? ' lit' : '') + '"' + ' data-anchor="stage.transport">';
    s += '<line x1="-22" x2="' + (laneW - 22) + '" y1="' + laneY + '" y2="' + laneY + '" class="lane-line"/>';
    s += '<text x="' + (laneW - 22) + '" y="' + (laneY + (tall ? -8 : 18)) + '" class="sub" text-anchor="end">' + esc('Transport: ' + ((o.lane && o.lane.name) || '') + '. Never trusted.') + '</text>';
    s += '</g>';
    if (L) s += L.svg;
    if (R) s += R.svg;
    // Message path between the two.
    var path = null;
    if (o.message && L && R) {
      var from = o.message.from === o.left.id ? L : R;
      var to = o.message.to === o.left.id ? L : (o.message.to === (o.right && o.right.id) ? R : null);
      if (to && from !== to) {
        var a = from.outPort;
        var b = to.inPort;
        var d = 'M' + a.x + ' ' + a.y + ' H' + (a.x + 22) + ' V' + laneY + ' H' + (b.x - 22) + ' V' + b.y + ' H' + (b.x - 1);
        path = d;
        var active = o.message.active;
        s += '<path id="ax-msg-path" d="' + d + '" class="msg-path' + (active ? ' active' : '') + '" marker-end="url(#' + (active ? 'ax-arrow-accent' : 'ax-arrow') + ')"/>';
        var lx = (a.x + 22 + b.x - 22) / 2;
        var label = o.message.label || '';
        var lw = label.length * 6.6 + 18;
        s += '<g class="msg-label' + (active ? ' active' : '') + '">' + rect(lx - lw / 2, laneY - 11, lw, 22, 'msg-label-bg', 11) + text(lx, laneY + 4, label, 'msg-label-text', 'middle') + '</g>';
        if (active) s += '<g id="ax-packet" class="packet"><rect x="-11" y="-8" width="22" height="16" rx="3" class="packet-body"/><path d="M-11 -8 L0 1 L11 -8" class="packet-flap"/></g>';
      }
    }
    s += '</svg>';
    return { svg: s, path: path };
  }

  AX.diagram = { agent: agent, service: service, stage: stage, DEFS: DEFS, W: W, H: H, HX: HX, CONSULTS: CONSULTS, rect: rect, text: text };
})();
