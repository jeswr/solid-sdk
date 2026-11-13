// AUTHORED-BY Claude Opus 5.5
// The Explore view: configuration bar, chat, stage, inspector, timeline, player. Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var E = (AX.explore = {});

  var root = null;
  var S = {
    trace: null,
    idx: 0,
    level: 'checks',
    playing: false,
    speed: 1,
    present: false,
    pair: null, // [leftId, rightId] kept stable while the same two parties are on stage
    lastIdx: -1,
  };
  var timer = null;
  var raf = null;
  var LEVELS = [['steps', 'Steps'], ['checks', 'Checks'], ['raw', 'Raw']];
  var SPEEDS = [0.5, 1, 2];

  // ---- Icons ---------------------------------------------------------------
  var ICON = {
    restart: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4v5h5" /><path d="M4.6 12.5A6 6 0 1 0 6 6.2L4 9"/></svg>',
    back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
    next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
    play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.2v11.6L15.5 10z" class="fill"/></svg>',
    pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5h2.6v11H6zM11.4 4.5H14v11h-2.6z" class="fill"/></svg>',
  };

  // ---- Skeleton -------------------------------------------------------------
  function skeleton() {
    var cfg = AX.orderedLayers.map(function (l) {
      return '<div class="cfg-item" data-layer="' + l.id + '" data-anchor="config.' + l.id + '">' +
        '<label for="cfg-' + l.id + '" title="' + esc(l.question) + '"><span class="lbadge' + (l.group === 'plumbing' ? ' plumb' : '') + '">' + esc(AX.layerLabel(l)) + '</span>' + esc(l.name) + '</label>' +
        '<select id="cfg-' + l.id + '" data-layer="' + l.id + '"></select></div>';
    }).join('');
    var scen = AX.scenarioIds.map(function (id) {
      return '<option value="' + esc(id) + '">' + esc(AX.scenarioTitle(id) + (AX.scenarioHasReal(id) ? '' : ' (fixture)')) + '</option>';
    }).join('');
    return '' +
      '<section class="explore" aria-label="Explore a trace">' +
      '<div class="cfg" data-anchor="config">' +
      '  <div class="cfg-scn"><label for="scenario">Scenario</label><select id="scenario">' + scen + '</select>' +
      '  <p class="scn-summary" id="scn-summary"></p>' +
      (AX.model.configurationNote ? '<details class="cfg-note"><summary>How configurations work</summary><p>' + esc(AX.model.configurationNote) + '</p></details>' : '') +
      '</div>' +
      '  <details class="cfg-layers" id="cfg-layers" open><summary><span>Configuration</span> <span class="cfg-name" id="cfg-name"></span></summary>' +
      '  <div class="cfg-grid">' + cfg + '</div></details>' +
      '</div>' +
      '<aside class="chat" data-anchor="chat" aria-label="Principal chat"><details id="chat-details" open><summary>Sam\'s chat</summary><ol class="chat-list" id="chat-list"></ol></details></aside>' +
      '<section class="stage" aria-label="Stage">' +
      '  <div class="parties" id="parties" data-anchor="stage.parties"></div>' +
      '  <div class="pay-choice" id="pay-choice" data-anchor="stage.payment" hidden></div>' +
      '  <div class="stage-body"><div class="stage-figure" id="stage-figure"></div><pre class="raw" id="raw" hidden></pre></div>' +
      '  <p class="caption" id="caption" aria-live="polite" data-anchor="stage.caption"></p>' +
      '</section>' +
      '<aside class="inspector" id="inspector" data-anchor="inspector" aria-label="Inspector"></aside>' +
      '<footer class="timeline" data-anchor="timeline">' +
      '  <div class="controls">' +
      '    <div class="btns">' +
      '      <button type="button" class="icon-btn" id="btn-restart" aria-label="Restart" title="Restart (Home)">' + ICON.restart + '</button>' +
      '      <button type="button" class="icon-btn" id="btn-back" aria-label="Back" title="Back (left arrow)">' + ICON.back + '</button>' +
      '      <button type="button" class="icon-btn play" id="btn-play" aria-label="Play" title="Play or pause (space)" data-anchor="controls.play">' + ICON.play + '</button>' +
      '      <button type="button" class="icon-btn" id="btn-next" aria-label="Next" title="Next (right arrow)">' + ICON.next + '</button>' +
      '    </div>' +
      '    <div class="seg" role="group" aria-label="Level of detail" data-anchor="controls.levels">' +
      LEVELS.map(function (l) { return '<button type="button" data-level="' + l[0] + '">' + l[1] + '</button>'; }).join('') +
      '    </div>' +
      '    <div class="seg small" role="group" aria-label="Speed">' +
      SPEEDS.map(function (s) { return '<button type="button" data-speed="' + s + '">' + s + 'x</button>'; }).join('') +
      '    </div>' +
      '    <div class="pos" id="pos" aria-live="polite"></div>' +
      '    <div class="legend" id="legend"></div>' +
      '  </div>' +
      '  <div class="scrub" id="scrub" data-anchor="timeline.scrubber"></div>' +
      '</footer>' +
      '<button type="button" class="present-exit" id="present-exit">Exit presentation</button>' +
      '</section>';
  }

  E.mount = function (container, params) {
    root = container;
    root.innerHTML = skeleton();
    root.querySelector('.cfg-grid').style.setProperty('--cfg-cols', 'repeat(' + Math.ceil(AX.orderedLayers.length / 2) + ', minmax(0, 1fr))');
    if (window.innerWidth < 760) {
      root.querySelector('#cfg-layers').open = false;
      root.querySelector('#chat-details').open = false;
    }
    root.querySelector('#scenario').addEventListener('change', function (e) {
      stop();
      var base = AX.baselineTrace(e.target.value);
      S.pair = null;
      E.apply({ scenario: e.target.value, config: base.configuration.id, level: S.level });
    });
    root.querySelectorAll('.cfg-item select').forEach(function (sel) {
      sel.addEventListener('change', function () { changeSuite(sel.dataset.layer, sel.value); });
    });
    root.querySelector('#btn-restart').addEventListener('click', function () { stop(); go(0); });
    root.querySelector('#btn-back').addEventListener('click', function () { stop(); move(-1); });
    root.querySelector('#btn-next').addEventListener('click', function () { stop(); move(1); });
    root.querySelector('#btn-play').addEventListener('click', toggle);
    root.querySelector('#present-exit').addEventListener('click', function () { S.present = false; applyPresent(); writeHash(); });
    root.querySelectorAll('[data-level]').forEach(function (b) {
      b.addEventListener('click', function () { setLevel(b.dataset.level); });
    });
    root.querySelectorAll('[data-speed]').forEach(function (b) {
      b.addEventListener('click', function () { S.speed = Number(b.dataset.speed); renderControls(); writeHash(); if (S.playing) schedule(); });
    });
    root.querySelector('#scrub').addEventListener('click', function (e) {
      var t = e.target.closest('[data-i]');
      if (!t) return;
      stop();
      var i = Number(t.dataset.i);
      if (S.level === 'steps') i = stepOf(i).last;
      go(stopIndexFor(i));
    });
    root.querySelector('#pay-choice').addEventListener('click', function (e) {
      var b = e.target.closest('[data-settle]');
      if (b && !b.disabled && b.getAttribute('aria-pressed') !== 'true') changeSuite('settlement', b.dataset.settle);
    });
    root.querySelector('#inspector').addEventListener('click', function (e) {
      var j = e.target.closest('[data-jump]');
      if (j) { stop(); go(stopIndexFor(Number(j.dataset.jump))); }
      var f = e.target.closest('[data-rdf-form]');
      if (f) { S.rdfForm = f.dataset.rdfForm; renderInspector(); }
      if (e.target.closest('[data-rdf-context]')) { S.rdfContext = !S.rdfContext; renderInspector(); }
    });
    E.apply(params || {});
  };
  E.unmount = function () { stop(); root = null; };
  E.isMounted = function () { return !!root; };

  // ---- State ---------------------------------------------------------------
  function stops() {
    if (S.level === 'steps') return AX.stepsOf(S.trace).map(function (s) { return s.last; });
    return S.trace.events.map(function (_, i) { return i; });
  }
  function stopIndexFor(i) {
    var st = stops();
    for (var k = 0; k < st.length; k++) if (st[k] >= i) return k;
    return st.length - 1;
  }
  function curStop() { return stopIndexFor(S.idx); }
  function stepOf(i) { return AX.stepAt(S.trace, i); }

  // Resolve hash params into state and render.
  E.apply = function (p) {
    var scenario = p.scenario && AX.tracesFor(p.scenario).length ? p.scenario : AX.scenarioIds[0];
    if (!scenario) { root.innerHTML = '<p class="empty">No traces are loaded. Run node scripts/bundle-data.mjs.</p>'; return; }
    var t = (p.config && AX.traceByKey[scenario + '--' + p.config]) || AX.baselineTrace(scenario);
    var changed = t !== S.trace;
    S.trace = t;
    S.level = LEVELS.some(function (l) { return l[0] === p.level; }) ? p.level : (p.level ? 'checks' : S.level || 'checks');
    if (p.speed && SPEEDS.indexOf(Number(p.speed)) >= 0) S.speed = Number(p.speed);
    S.present = p.present === '1';
    var ev = t.events;
    var idx = 0;
    var steps = AX.stepsOf(t);
    var stepN = p.step ? Number(p.step) : null;
    var step = stepN != null ? steps.filter(function (s) { return s.n === stepN; })[0] : null;
    if (p.seq) {
      for (var i = 0; i < ev.length; i++) if (ev[i].seq === Number(p.seq)) { idx = i; break; }
    } else if (step) {
      idx = S.level === 'steps' ? step.last : step.first;
    }
    if (step && p.focus) {
      // focus=agent.kind.check (any part may be empty): first matching event in the step.
      var f = p.focus.split('.');
      for (var j = step.first; j <= step.last; j++) {
        var e = ev[j];
        if ((!f[0] || e.agent === f[0]) && (!f[1] || e.kind === f[1]) && (!f[2] || e.check === f[2] || e.part === f[2])) { idx = j; break; }
      }
    }
    if (S.level === 'steps') idx = stepOf(idx).last;
    if (changed) S.pair = null;
    S.idx = idx;
    if (changed || !root.querySelector('.scrub-track')) renderScrub();
    renderConfig();
    applyPresent();
    render();
    if (p.play === '1') { if (!S.playing) play(); } else if (S.playing) stop();
    writeHash();
  };

  function writeHash() {
    if (!root) return;
    var e = S.trace.events[S.idx];
    var params = { scenario: S.trace.scenario.id, config: S.trace.configuration.id, step: e.step, seq: e.seq, level: S.level };
    if (S.speed !== 1) params.speed = S.speed;
    if (S.playing) params.play = 1;
    if (S.present) params.present = 1;
    var h = AX.buildHash('explore', params);
    AX.lastExploreHash = h;
    AX.go(h, { replace: true, silent: true });
    if (AX.onExploreHash) AX.onExploreHash(h);
  }

  function go(stopIdx) {
    var st = stops();
    stopIdx = Math.max(0, Math.min(st.length - 1, stopIdx));
    S.idx = st[stopIdx];
    render();
    writeHash();
  }
  function move(d) { go(curStop() + d); }
  E.move = function (d) { stop(); move(d); };
  E.home = function () { stop(); go(0); };
  E.end = function () { stop(); go(stops().length - 1); };
  E.toggle = function () { toggle(); };

  function setLevel(l) {
    S.level = l;
    if (l === 'steps') S.idx = stepOf(S.idx).last;
    renderControls();
    render();
    writeHash();
    if (S.playing) schedule();
  }

  // ---- Player --------------------------------------------------------------
  function holdFor(e) {
    var base = 900 + Math.min(220, (e.caption || '').length) * 22;
    if (e.kind === 'message-out' || e.kind === 'message-in') base += 400;
    if (S.level === 'steps') base += 1200;
    return base / S.speed;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!S.playing || !root) return;
      if (curStop() >= stops().length - 1) { stop(); writeHash(); return; }
      move(1);
      schedule();
    }, holdFor(S.trace.events[S.idx]));
  }
  function play() {
    if (curStop() >= stops().length - 1) go(0);
    S.playing = true;
    renderControls();
    schedule();
    writeHash();
  }
  function stop() {
    if (!S.playing) return;
    S.playing = false;
    clearTimeout(timer);
    if (root) renderControls();
  }
  function toggle() {
    if (S.playing) { stop(); writeHash(); } else play();
  }
  E.stop = stop;

  function applyPresent() {
    document.body.classList.toggle('present', !!S.present);
  }

  // ---- Configuration bar ---------------------------------------------------
  function selection() { return S.trace.layersFull; }
  function changeSuite(layerId, suiteId) {
    stop();
    var sc = S.trace.scenario.id;
    var want = Object.assign({}, selection());
    want[layerId] = suiteId;
    var t = AX.findTraceByLayers(sc, want);
    if (!t) {
      var b = Object.assign({}, AX.baselineLayers);
      b[layerId] = suiteId;
      t = AX.findTraceByLayers(sc, b);
    }
    if (!t) { renderConfig(); return; }
    var cur = S.trace.events[S.idx];
    E.apply({ scenario: sc, config: t.configuration.id, step: cur.step, level: S.level, focus: [cur.agent, cur.kind, cur.check || cur.part].join('.') });
  }
  function suiteEnabled(layerId, suiteId) {
    var sc = S.trace.scenario.id;
    var a = Object.assign({}, selection());
    a[layerId] = suiteId;
    if (AX.findTraceByLayers(sc, a)) return true;
    var b = Object.assign({}, AX.baselineLayers);
    b[layerId] = suiteId;
    return !!AX.findTraceByLayers(sc, b);
  }
  function renderConfig() {
    var t = S.trace;
    root.querySelector('#scenario').value = t.scenario.id;
    var standIns = (t.standIns || []).map(function (x) { return x.what + ': ' + x.replacedBy; }).join('. ');
    root.querySelector('#scn-summary').textContent = AX.scenarioMeta(t.scenario.id).summary || (standIns ? 'Local stand-ins in this run. ' + standIns + '.' : '');
    root.querySelector('#cfg-name').textContent = AX.configLabel(t);
    AX.orderedLayers.forEach(function (l) {
      var sel = root.querySelector('#cfg-' + l.id);
      var cur = t.layersFull[l.id];
      sel.innerHTML = l.suites.map(function (s) {
        var on = s.id === cur || suiteEnabled(l.id, s.id);
        return '<option value="' + s.id + '"' + (s.id === cur ? ' selected' : '') + (on ? '' : ' disabled') + '>' +
          esc(s.name + (on ? '' : ' (not run yet)')) + '</option>';
      }).join('');
      sel.value = cur;
      var item = sel.closest('.cfg-item');
      item.classList.toggle('changed', cur !== AX.baselineLayers[l.id]);
      item.title = AX.suiteName(l.id, cur) + ': ' + (AX.suite(l.id, cur) || {}).summary;
    });
    document.dispatchEvent(new CustomEvent('ax:trace', { detail: t }));
  }

  // ---- The choice at the point of payment ----------------------------------
  // Shown only while the trace is inside its payment stretch. Changing it switches to the
  // run of the same journey with only the way of settling changed, at the same place.
  function renderPayChoice() {
    var el = root.querySelector('#pay-choice');
    var st = AX.settlement;
    var r = st && AX.segmentRange(S.trace, 'payment');
    if (!st || !r || S.idx < r[0] || S.idx > r[1]) { el.hidden = true; el.innerHTML = ''; return; }
    var cur = S.trace.layersFull[st.id];
    var curSuite = AX.suite(st.id, cur) || {};
    el.hidden = false;
    el.innerHTML = '<span class="pay-label">Payment, settled by</span>' +
      '<span class="seg small" role="group" aria-label="How the payment is settled">' + st.suites.map(function (s) {
        var on = s.id === cur || suiteEnabled(st.id, s.id);
        return '<button type="button" data-settle="' + esc(s.id) + '" aria-pressed="' + (s.id === cur) + '"' + (on ? '' : ' disabled') +
          ' title="' + esc(s.name + '. ' + s.summary + (on ? '' : ' Not run yet.')) + '">' + esc(s.short || s.name) + '</button>';
      }).join('') + '</span>' +
      '<span class="pay-note">' + esc((curSuite.summary ? curSuite.summary + ' ' : '') + 'The same checks run whichever is chosen.') + '</span>';
  }

  // ---- Timeline -----------------------------------------------------------
  function renderScrub() {
    var t = S.trace;
    var diff = AX.diffSteps(t);
    var html = '<div class="scrub-track" role="group" aria-label="Timeline">';
    AX.stepsOf(t).forEach(function (s) {
      html += '<div class="scrub-step' + (diff[s.n] ? ' differs' : '') + '" style="flex:' + Math.max(s.events.length, 3) + '" data-run="' + s.first + '">';
      html += '<button type="button" class="scrub-label" data-i="' + s.first + '" title="' + esc('Step ' + s.n + ': ' + AX.stepTitle(t.scenario.id, s.n, t) + (diff[s.n] ? ' (differs from baseline)' : '')) + '">' + s.n + '</button>';
      html += '<div class="ticks">';
      for (var i = s.first; i <= s.last; i++) {
        var e = t.events[i];
        var v = e.verdict && e.verdict !== 'pass' && e.verdict !== 'not-applicable' ? ' v-' + AX.verdicts[e.verdict].cls : '';
        var k = e.kind === 'check' ? ' chk' : (e.kind.indexOf('message') === 0 ? ' msg' : '');
        html += '<span class="tick' + k + v + '" data-i="' + i + '" title="' + esc(e.seq + '. ' + e.caption) + '"></span>';
      }
      html += '</div></div>';
    });
    html += '</div>';
    root.querySelector('#scrub').innerHTML = html;
    var nd = Object.keys(diff).length;
    root.querySelector('#legend').innerHTML = nd
      ? '<span class="legend-item"><span class="legend-mark differs"></span>' + nd + (nd === 1 ? ' step differs' : ' steps differ') + ' from the baseline</span>'
      : '';
  }
  function renderControls() {
    root.querySelectorAll('[data-level]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.level === S.level)); });
    root.querySelectorAll('[data-speed]').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === S.speed)); });
    var pb = root.querySelector('#btn-play');
    pb.innerHTML = S.playing ? ICON.pause : ICON.play;
    pb.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    pb.classList.toggle('on', S.playing);
    root.querySelector('.explore').classList.toggle('level-raw', S.level === 'raw');
  }
  function renderPos() {
    var t = S.trace;
    var e = t.events[S.idx];
    var steps = AX.stepsOf(t);
    var sIdx = steps.indexOf(stepOf(S.idx)) + 1;
    root.querySelector('#pos').innerHTML = '<strong>Step ' + esc(e.step) + '</strong><span>' + sIdx + ' of ' + steps.length + ' steps</span><span>Event ' + (S.idx + 1) + ' of ' + t.events.length + '</span>';
    root.querySelector('#btn-back').disabled = curStop() === 0;
    root.querySelector('#btn-next').disabled = curStop() >= stops().length - 1;
    var cur = root.querySelector('.tick.cur');
    if (cur) cur.classList.remove('cur');
    var tick = root.querySelector('.tick[data-i="' + S.idx + '"]');
    if (tick) tick.classList.add('cur');
    root.querySelectorAll('.scrub-step.cur').forEach(function (n) { n.classList.remove('cur'); });
    var ss = root.querySelector('.scrub-step[data-run="' + stepOf(S.idx).first + '"]');
    if (ss) ss.classList.add('cur');
    root.querySelectorAll('.tick.past').forEach(function (n) { n.classList.remove('past'); });
  }

  // ---- Chat ---------------------------------------------------------------
  function renderChat() {
    var t = S.trace;
    var html = '';
    var last = -1;
    for (var i = 0; i <= S.idx; i++) if (t.events[i].chat) last = i;
    for (var k = 0; k <= S.idx; k++) {
      var e = t.events[k];
      if (!e.chat) continue;
      var who = e.chat.who === 'principal' ? 'principal' : 'agent';
      var name = who === 'principal' ? principalName() : chatAgentName();
      html += '<li class="bubble ' + who + (k === last ? ' latest' : '') + (k === S.idx ? ' now' : '') + '"><span class="who">' + esc(name) + '</span>' + esc(e.chat.text) + '</li>';
    }
    var list = root.querySelector('#chat-list');
    var owner = principalName();
    var sum = root.querySelector('#chat-details summary');
    if (sum) sum.textContent = owner === 'Principal' ? 'The principal\'s chat' : owner + '\'s chat';
    list.innerHTML = html || '<li class="chat-empty">' + esc(owner === 'Principal' ? 'This run has no conversation with a principal.' : 'The conversation with ' + owner.replace(/^The /, 'the ') + ' appears here as the agent works. In this run nothing was put to them.') + '</li>';
    var box = root.querySelector('.chat');
    box.scrollTop = box.scrollHeight;
  }
  function principalName() {
    var a = S.trace.agents.filter(function (x) { return (AX.partyById[x.id] || {}).kind === 'person'; })[0];
    if (a) return a.name;
    var ag = S.trace.agents.filter(function (x) { return x.id === 'sams-agent'; })[0] || S.trace.agents[0];
    var p = ag && AX.partyById[ag.actsFor];
    if (p) return p.name;
    var tp = ag && (S.trace.parties || []).filter(function (x) { return x.id === ag.actsFor; })[0];
    if (tp) return tp.name;
    if (ag && ag.actsFor && /^[a-z0-9-]+$/.test(ag.actsFor)) return 'The ' + ag.actsFor.replace(/-/g, ' ');
    return (ag && ag.actsFor) || 'Principal';
  }
  function chatAgentName() {
    var ag = S.trace.agents.filter(function (x) { return x.id === 'sams-agent'; })[0] || S.trace.agents[0];
    return ag ? ag.name : 'The agent';
  }

  // ---- Stage --------------------------------------------------------------
  function partyKind(id) {
    var p = AX.partyById[id];
    return p ? p.kind : 'agent';
  }
  function traceAgent(id) {
    return S.trace.agents.filter(function (a) { return a.id === id; })[0] || { id: id, name: (AX.partyById[id] || {}).name || id, role: '' };
  }
  function counterpartAt(i) {
    var ev = S.trace.events;
    var me = ev[i].agent;
    function other(e) {
      if (!e.packet) return null;
      if (e.pFrom === me) return e.pTo;
      if (e.pTo === me) return e.pFrom;
      return null;
    }
    for (var k = i; k >= 0; k--) { var o = other(ev[k]); if (o && o !== me) return o; }
    for (var j = i + 1; j < ev.length; j++) { var o2 = other(ev[j]); if (o2 && o2 !== me) return o2; }
    return null;
  }
  function latestPacket(i, a, b) {
    var ev = S.trace.events;
    for (var k = i; k >= 0; k--) {
      var x = ev[k];
      if (x.packet && ((x.pFrom === a && x.pTo === b) || (x.pFrom === b && x.pTo === a))) return { p: x.packet, from: x.pFrom, to: x.pTo, k: k };
    }
    return null;
  }
  function partyView(id, i, acting) {
    var a = traceAgent(id);
    var e = S.trace.events[i];
    var kind = partyKind(id);
    var v = { id: id, name: a.name, kind: kind === 'service' ? 'service' : 'agent', badge: acting ? 'Acting' : 'Counterpart', acting: acting, compact: true };
    var party = AX.partyById[id] || {};
    var tParty = (S.trace.parties || []).filter(function (x) { return x.id === a.actsFor; })[0];
    var actsFor = a.actsFor && a.actsFor !== id ? (AX.partyById[a.actsFor] || tParty || {}).name || a.actsFor : (party.actsFor ? (AX.partyById[party.actsFor] || {}).name : a.name);
    v.role = a.role || party.role || '';
    if (v.kind === 'agent') {
      v.principal = actsFor || a.name;
      v.role = (a.role || party.role || 'Agent') + (actsFor && actsFor !== a.name ? ', acts for ' + actsFor : '');
      v.gates = {
        'inbound-gate': AX.gateAt(S.trace, id, 'inbound-gate', i),
        'outbound-gate': AX.gateAt(S.trace, id, 'outbound-gate', i),
      };
      if (acting) {
        v.lit = { part: e.part, check: e.check, resolution: !!e.resolution };
        v.anchors = 'stage';
      }
    }
    return v;
  }
  function stageLayout() {
    var fig = root.querySelector('#stage-figure');
    var w = fig.clientWidth || 800;
    return w < 640 ? 'tall' : 'wide';
  }
  function renderStage() {
    var t = S.trace;
    var i = S.idx;
    var e = t.events[i];
    var acting = e.agent;
    var other = counterpartAt(i);
    // Left is always the agent acting in this event; right is its counterpart, drawn smaller.
    var pair = [acting, other];
    var left = partyView(pair[0], i, true);
    var right = pair[1] ? partyView(pair[1], i, false) : null;
    if (right) right.scale = 0.62;
    var msg = null;
    var isMsg = e.kind === 'message-out' || e.kind === 'message-in';
    if (isMsg && e.packet) {
      msg = { from: e.pFrom, to: e.pTo, active: true, label: e.packet.kind };
    } else if (right) {
      var lp = latestPacket(i, pair[0], pair[1]);
      if (lp) msg = { from: lp.from, to: lp.to, active: false, label: lp.p.kind };
    }
    var laneSuite = e.packet ? e.packet.carriage.suite : t.layersFull.transport;
    var out = AX.diagram.stage({
      left: left,
      right: right,
      layout: stageLayout(),
      lane: { name: AX.suiteName('transport', laneSuite), lit: e.part === 'transport' },
      message: msg,
      label: left.name + (right ? ' and ' + right.name : '') + '. ' + e.caption,
    });
    var fig = root.querySelector('#stage-figure');
    fig.innerHTML = out.svg;
    // Party strip.
    var strip = t.agents.map(function (a) {
      var on = a.id === acting ? ' acting' : (a.id === other ? ' counterpart' : '');
      if (a.id === 'sam' && e.part === 'principal') on = ' acting';
      return '<span class="party ' + partyKind(a.id) + on + '" title="' + esc(a.role) + '"><span class="dot"></span>' + esc(a.name) + '</span>';
    }).join('');
    root.querySelector('#parties').innerHTML = strip;
    // Packet animation.
    cancelAnimationFrame(raf);
    var path = fig.querySelector('#ax-msg-path.active');
    var pk = fig.querySelector('#ax-packet');
    if (path && pk) {
      var len = path.getTotalLength();
      var leg = e.leg || [0, 1];
      var startFrac = leg[0];
      var endFrac = leg[1];
      var place = function (f) {
        var pt = path.getPointAtLength(len * f);
        pk.setAttribute('transform', 'translate(' + pt.x + ' ' + pt.y + ')');
      };
      if (AX.reducedMotion() || S.lastIdx === i) { place(endFrac); } else {
        var dur = 1100 / S.speed;
        var t0 = performance.now();
        place(startFrac);
        var stepFn = function (now) {
          var k = Math.min(1, (now - t0) / dur);
          var ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          place(startFrac + (endFrac - startFrac) * ease);
          if (k < 1) raf = requestAnimationFrame(stepFn);
        };
        raf = requestAnimationFrame(stepFn);
      }
    }
    var cap = root.querySelector('#caption');
    cap.textContent = e.caption;
    var raw = root.querySelector('#raw');
    raw.hidden = S.level !== 'raw';
    if (S.level === 'raw') raw.textContent = JSON.stringify(e, null, 2);
  }

  // ---- Inspector ----------------------------------------------------------
  function refsHtml(refs) {
    if (!refs || !refs.length) return '';
    return '<dl class="kv"><dt>Spec layers exercised</dt><dd><ul class="refs">' + refs.map(function (r) {
      var l = AX.layerById[r.layer];
      return '<li><a href="' + AX.buildHash('layers', { select: r.layer + '/' + r.suite }) + '"><span class="ref-layer">' + esc(l ? AX.layerTitle(l) : r.layer) + '</span><span class="ref-suite">' + esc(AX.suiteName(r.layer, r.suite)) + '</span></a>' + (r.clause ? '<code>' + esc(r.clause) + '</code>' : '') + '</li>';
    }).join('') + '</ul></dd></dl>';
  }
  // The whole message as linked data. JSON-LD first, with its context folded away;
  // the same graph as Turtle (or TriG, where the proof sits in a named graph) one click behind.
  // Traces made before messages were RDF have none of these fields and show nothing here.
  function rdfHtml(p) {
    if (!p || p.jsonld === undefined || p.jsonld === null) return '';
    var text = p.turtle || p.trig || '';
    var textName = p.turtle ? 'Turtle' : 'TriG';
    var form = S.rdfForm === 'text' && text ? 'text' : 'jsonld';
    var doc = p.jsonld;
    var ctx = p.context !== undefined ? p.context : (doc && doc['@context']);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      var shown = {};
      if (S.rdfContext && ctx !== undefined) shown['@context'] = ctx;
      Object.keys(doc).forEach(function (k) { if (k !== '@context') shown[k] = doc[k]; });
      doc = shown;
    }
    var h = '<div class="rdf" data-anchor="inspector.message.rdf"><div class="rdf-head"><span class="ln">As linked data</span>';
    if (text) {
      h += '<span class="seg small" role="group" aria-label="Form">' +
        '<button type="button" data-rdf-form="jsonld" aria-pressed="' + (form === 'jsonld') + '">JSON-LD</button>' +
        '<button type="button" data-rdf-form="text" aria-pressed="' + (form === 'text') + '">' + textName + '</button></span>';
    }
    h += '</div>';
    if (form === 'jsonld') {
      h += '<pre class="json rdf-doc">' + esc(JSON.stringify(doc, null, 2)) + '</pre>';
      if (ctx !== undefined) {
        h += '<p class="rdf-note">' + (S.rdfContext
          ? 'The context maps each short name to a full term. It is pinned: the gate never fetches it.'
          : 'The context, which maps each short name to a full term, is folded away.') +
          ' <button type="button" class="linkish" data-rdf-context="1">' + (S.rdfContext ? 'Hide context' : 'Show context') + '</button></p>';
      }
    } else {
      h += '<pre class="json rdf-doc">' + esc(text) + '</pre><p class="rdf-note">The same graph, written out in full.</p>';
    }
    return h + '</div>';
  }
  function packetHtml(p, e) {
    var sender = (e.pFrom && traceAgent(e.pFrom).name) || p.from;
    var receiver = (e.pTo && traceAgent(e.pTo).name) || p.to;
    var h = '<section class="msg" data-anchor="inspector.message"><h3>Verifiable message</h3>';
    h += '<p class="msg-meta"><code>' + esc(p.id) + '</code> <span class="kind-chip">' + esc(p.kind) + '</span> ' + esc(sender) + ' to ' + esc(receiver) + '</p>';
    h += rdfHtml(p);
    h += '<div class="layer carriage"><div class="layer-head"><span class="ln">Carriage</span><span class="lstate untrusted">Never trusted</span></div><p>' + esc(AX.suiteName('transport', p.carriage.suite) + '. ' + p.carriage.summary) + '</p></div>';
    h += '<div class="signed"><div class="signed-label">Signed by ' + esc(sender) + '</div>';
    AX.model.message.layers.filter(function (l) { return l.signed; }).forEach(function (ml) {
      var lv = (p.layers && p.layers[ml.id]) || { present: false, summary: 'Not in this trace.' };
      var cls = 'layer ' + (lv.present ? 'present' : 'absent');
      var head = '<span class="ln">' + esc(ml.name) + '</span><span class="lstate">' + (lv.present ? 'Present' : 'Absent') + '</span>';
      var body = '<p>' + esc(lv.summary) + '</p>';
      if (lv.present && lv.raw !== undefined) {
        h += '<details class="' + cls + '"><summary class="layer-head">' + head + '</summary>' + body +
          '<p class="read-by">Read by: ' + esc(ml.readBy) + '</p>' +
          '<pre class="json">' + esc(JSON.stringify(lv.raw, null, 2)) + '</pre>' + (lv.digest ? '<p class="digest"><code>' + esc(lv.digest) + '</code></p>' : '') + '</details>';
      } else {
        h += '<div class="' + cls + '"><div class="layer-head">' + head + '</div>' + body + '</div>';
      }
    });
    h += '</div></section>';
    return h;
  }
  // A payment event: the chosen protocol's own objects as they were sent, then the terms the
  // gate lifted from them and checked. The second part reads the same under every choice.
  function show(v) { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); }
  function settlementHtml(s) {
    var suite = AX.suite('settlement', s.suite) || { name: s.suite };
    var h = '<section class="settle" data-anchor="inspector.settlement"><h3>Payment: ' + esc(suite.name) + '</h3>';
    var objects = s.objects || [];
    if (objects.length) h += '<p class="settle-sub">What was sent, in this protocol\'s own form</p>';
    objects.forEach(function (o) {
      h += '<details class="layer present"><summary class="layer-head"><span class="ln">' + esc(o.name) + '</span><span class="lstate">' + esc(o.form || '') + '</span></summary>';
      if (o.shown !== undefined) h += '<pre class="json">' + esc(show(o.shown)) + '</pre>';
      if (o.raw !== undefined) h += '<details class="as-sent"><summary>As sent</summary><pre class="json">' + esc(show(o.raw)) + '</pre></details>';
      h += '</details>';
    });
    if (s.note) h += '<p class="rdf-note">' + esc(s.note) + '</p>';
    var facts = s.facts;
    if (facts !== undefined && facts !== null) {
      h += '<p class="settle-sub">What the gate read from it and checked</p>';
      if (Array.isArray(facts) && facts.length && facts.every(function (f) { return f && typeof f === 'object' && f.value !== undefined; })) {
        h += '<dl class="kv facts">' + facts.map(function (f) {
          return '<dt>' + esc(f.label || f.name || f.term || '') + '</dt><dd>' + esc(show(f.value)) + (f.from ? '<div class="rule-id">from <code>' + esc(f.from) + '</code></div>' : '') + '</dd>';
        }).join('') + '</dl>';
      } else {
        h += '<pre class="json rdf-doc">' + esc(show(facts)) + '</pre>';
      }
      h += '<p class="rdf-note">These terms are the same whichever way of settling is chosen, and the same checks run on them.</p>';
    }
    return h + '</section>';
  }
  function checkHtml(e) {
    var c = AX.checkById[e.check] || { name: e.check, question: '', n: '' };
    var h = '<section class="chk' + (e.verdict === 'not-applicable' ? ' quiet' : '') + '" data-anchor="inspector.check"><h3>' + esc(c.n + '. ' + c.name) + ' check</h3>';
    h += '<p class="question">' + esc(c.question) + '</p>';
    h += '<div class="verdict-row">' + AX.verdictPill(e.verdict) + (e.reason ? '<code class="reason">' + esc(e.reason) + '</code>' : '') + '</div>';
    if (e.resolution) h += AX.resolutionHtml(e.resolution);
    if (e.rule) h += '<dl class="kv"><dt>Rule</dt><dd>' + esc(e.rule.text) + '<div class="rule-id"><code>' + esc(e.rule.id) + '</code></div></dd></dl>';
    var store = AX.diagram.CONSULTS[e.check];
    if (store) h += '<dl class="kv"><dt>Reads</dt><dd>' + esc(AX.partName(store)) + '</dd></dl>';
    if (c.detail) h += '<p class="detail">' + esc(c.detail) + '</p>';
    h += refsHtml(e.refs) + '</section>';
    return h;
  }
  function stepSummaryHtml(step) {
    var t = S.trace;
    var groups = [];
    var gmap = {};
    step.events.forEach(function (e) {
      if (e.kind !== 'check' && e.kind !== 'decision') return;
      var key = e.agent + '|' + e.part;
      var g = gmap[key];
      if (!g || g.closed) {
        g = { agent: e.agent, part: e.part, checks: [], outcome: null, closed: false };
        gmap[key] = g;
        groups.push(g);
      }
      if (e.kind === 'check') g.checks.push(e);
      else { g.outcome = e.outcomeKey; if (e.outcomeKey !== 'ASK_PRINCIPAL') g.closed = true; }
    });
    var h = '<section class="step-sum"><h3>Checks in this step</h3>';
    if (!groups.length) h += '<p class="muted">No gate checks in this step.</p>';
    groups.forEach(function (g) {
      h += '<div class="gate-sum"><div class="gate-sum-head"><span>' + esc(traceAgent(g.agent).name) + '</span><span class="muted">' + esc(AX.partName(g.part)) + '</span>' + (g.outcome ? AX.outcomePill(g.outcome) : '') + '</div><ul>';
      var na = [];
      g.checks.forEach(function (c) {
        var i = c._i;
        var btn = '<button type="button" class="linkish" data-jump="' + i + '" title="' + esc(c.caption) + '">' + AX.glyphSvg(c.verdict, 14) + esc((AX.checkById[c.check] || {}).name || c.check) + '</button>';
        if (c.verdict === 'not-applicable') na.push('<li class="na-row">' + btn + (c.reason ? '<code>' + esc(c.reason) + '</code>' : '') + '</li>');
        else h += '<li>' + btn + '</li>';
      });
      h += '</ul>';
      if (na.length) h += '<details class="na-list"><summary>' + na.length + ' not applicable</summary><ul>' + na.join('') + '</ul></details>';
      h += '</div>';
    });
    h += '<p class="muted small">' + step.events.length + ' events in this step. Switch to Checks to see each one.</p></section>';
    return h;
  }
  function renderInspector() {
    var t = S.trace;
    var e = t.events[S.idx];
    var step = stepOf(S.idx);
    var steps = AX.stepsOf(t);
    var h = '<header class="insp-head"><p class="eyebrow">Step ' + esc(e.step) + '<span class="of">' + (steps.indexOf(step) + 1) + ' of ' + steps.length + '</span></p>';
    h += '<h2>' + esc(AX.stepTitle(t.scenario.id, e.step, t)) + '</h2>';
    h += '<p class="who"><span class="chip">' + esc(traceAgent(e.agent).name) + '</span><span class="chip">' + esc(AX.partName(e.part)) + '</span><span class="chip quiet">' + esc(AX.kindLabels[e.kind] || e.kind) + '</span></p></header>';
    if (S.level === 'steps') h += stepSummaryHtml(step);
    if (e.kind === 'check') h += checkHtml(e);
    else if (e.kind === 'decision') {
      h += '<section class="dec"><h3>' + esc(AX.partName(e.part)) + ' outcome</h3><div class="verdict-row">' + AX.outcomePill(e.outcomeKey) + (e.reason && e.reason !== e.outcomeKey ? '<code class="reason">' + esc(e.reason) + '</code>' : '') + '</div><p>' + esc(AX.outcomeSummary(e.outcomeKey)) + '</p></section>';
    }
    if (e.settlement) h += settlementHtml(e.settlement);
    if (e.packet) h += packetHtml(e.packet, e);
    if (e.kind !== 'check' && e.kind !== 'decision' && !e.packet) {
      var part = AX.partById[e.part];
      h += '<section class="part-info"><h3>' + esc(part ? part.name : e.part) + '</h3><p>' + esc(part ? part.summary : '') + '</p>';
      if (e.rule) h += '<dl class="kv"><dt>Rule</dt><dd>' + esc(e.rule.text) + '<div class="rule-id"><code>' + esc(e.rule.id) + '</code></div></dd></dl>';
      if (e.chat) h += '<dl class="kv"><dt>In the chat</dt><dd>' + esc(e.chat.text) + '</dd></dl>';
      if (e.fact) h += '<details class="layer present fact"><summary class="layer-head"><span class="ln">Fact stored</span><span class="lstate">' + esc(e.fact.claimType || '') + '</span></summary><pre class="json">' + esc(JSON.stringify(e.fact, null, 2)) + '</pre></details>';
      h += refsHtml(e.refs) + '</section>';
    } else if (e.packet) {
      h += refsHtml(e.refs);
    }
    var ins = root.querySelector('#inspector');
    var keepOpen = {};
    ins.querySelectorAll('details.layer').forEach(function (d, k) { if (d.open) keepOpen[k] = true; });
    ins.innerHTML = h;
    if (S.lastIdx === S.idx) ins.querySelectorAll('details.layer').forEach(function (d, k) { if (keepOpen[k]) d.open = true; });
  }

  function render() {
    if (!root || !S.trace) return;
    renderControls();
    renderPayChoice();
    renderStage();
    renderChat();
    renderInspector();
    renderPos();
    S.lastIdx = S.idx;
  }
  E.rerender = function () { if (root && S.trace) { S.lastIdx = S.idx; renderStage(); } };
  E.state = S;
  window.addEventListener('resize', function () { if (root) E.rerender(); });
})();
