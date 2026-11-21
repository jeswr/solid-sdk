// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Sam's phone: what the principal sees at the current step of a recorded run, drawn in the
// visual language of the Errand consumer app (apps/agent-chat). Everything shown is read from
// the trace: the chat, the mandate the agent holds, the approval it asks for and the answer.
// Steps the trace records but does not show on a screen (the face check, unlocking the signing
// key) are drawn as prompts and marked Illustrative. Classic script; the model is a pure
// function so that it can be tested without a browser.
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var AX = (root.AX = root.AX || {});
  var P = (AX.phone = {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function trimDot(s) { return String(s || '').replace(/[.\s]+$/, ''); }

  // The trace copy retains the engine's prose. Use the corresponding terms in the replay.
  P.displayText = function (trace, text) {
    var s = String(text || '').replace(/\b([Pp]ay) [Pp]ay\b/g, '$1');
    if (trace.useCase === 'mortgage-in-principle') {
      s = s.replace(/pass them on only to the unlabelled resource/g, 'pass them on only to the underwriter')
        .replace(/never for the unlabelled resource/g, 'never for marketing')
        .replace(/The fictional lender or the unlabelled resource/g, 'The fictional lender or the other lender named in the mandate')
        .replace(/distribute the unlabelled resource for Credit Assessment/g, 'share the mortgage evidence for credit assessment')
        .replace(/compensate the unlabelled resource for Mortgage Application/g, 'make a payment for the mortgage application')
        .replace(/use the unlabelled resource, on its own/g, 'grant access to the mortgage evidence by link, on its own');
      if (trace.scenario?.id === 'mortgage-injected-fee') {
        s = s.replace(/pay 450 USD to the unlabelled resource/g, 'pay 450 USD to the proposed valuer');
      }
    }
    switch (trace.useCase) {
    case 'health-referral':
      return s.replace(/use the unlabelled resource with The specialist clinic for Health referral/g,
        'share the patient history with the specialist clinic for the referral');
    case 'emergency-access':
      return s.replace(/read the unlabelled resource/g, 'read the allergy record');
    case 'probing-counterparty':
      return s.replace(/take the next step in the unlabelled resource/g, 'act on the service request');
    case 'production-change':
      return s.replace(/take the next step in the unlabelled resource/g, 'carry out the proposed change');
    case 'salary-account-change':
      return s.replace(/unsigned invoke not permitted by the unlabelled resource/g, 'the salary account change requires a signed request');
    default:
      return s;
    }
  };

  // ---- Reading the trace ----------------------------------------------------------------

  // "Sam, the fictional applicant" -> "Sam".
  P.shortName = function (name) {
    var n = String(name || '').split(',')[0].trim();
    return n || 'The principal';
  };

  // The agent that talks to the principal: the one whose events sit on the principal part.
  P.principalAgent = function (t) {
    var e = (t.events || []).filter(function (x) { return x.part === 'principal'; })[0];
    if (e) return e.agent;
    var a = (t.agents || []).filter(function (x) { return x.id === 'sams-agent'; })[0] || (t.agents || [])[0];
    return a ? a.id : null;
  };

  // The signed mandate, as the agent recorded it. Each rule reads "...'s mandate lets the agent
  // <what>, on its own." or "..., after <name> approves."; anything else is kept verbatim.
  P.mandate = function (t, agentId) {
    var ev = t.events || [];
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.kind === 'record' && e.agent === agentId && e.rule && /mandate/.test(e.rule.id || '')) {
        var rules = [];
        P.displayText(t, e.rule.text).split(/(?<=\.)\s+(?=[A-Z])/).forEach(function (s) {
          var m = s.match(/mandate lets the agent (.+?),? (on its own|after .+? approves)\.?$/);
          if (m) rules.push({ what: cap(m[1]), own: m[2] === 'on its own' });
          else if (s.trim()) rules.push({ what: s.trim(), own: null });
        });
        var until = (String(e.caption || '').match(/valid until (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
        return { i: i, rules: rules, until: until, caption: e.caption || '' };
      }
    }
    return null;
  };

  // Spending limits, exactly as the agent quoted them to the principal in this run.
  P.limits = function (t) {
    var out = [];
    var seen = {};
    function add(label, value) {
      var k = label + '|' + value;
      if (!seen[k]) { seen[k] = 1; out.push({ label: label, value: value }); }
    }
    (t.events || []).forEach(function (e) {
      if (!e.chat || e.chat.who === 'principal') return;
      var s = e.chat.text;
      var m = s.match(/limit is (\d[\d.,]* [A-Z]{3}) per payment(?: and (\d[\d.,]* [A-Z]{3}) per ([a-z ]+?))?[.?,]/);
      if (m) {
        add('Each payment', m[1]);
        if (m[2]) add('Per ' + m[3], m[2]);
        return;
      }
      var p = s.match(/payment limit is (\d[\d.,]* [A-Z]{3})/);
      if (p) add('Each payment', p[1]);
    });
    return out;
  };

  function amount(s) { return Number(String(s).replace(/[^\d.]/g, '')); }

  // What an ask is about, read from the agent's own words. Facts are substrings of the text.
  P.classifyAsk = function (text) {
    var s = String(text || '');
    var m;
    if (/face check/i.test(s)) {
      m = s.match(/^Before (.+?) will go ahead with (.+?), it asks/);
      return { kind: 'face', title: 'Confirm it is you', primary: 'Start the face check',
        facts: m ? [['Asked by', m[1]], ['For', m[2]], ['How', 'A certified face check']] : [] };
    }
    if ((m = s.match(/^May I pay (\d[\d.,]* [A-Z]{3}) to (.+?) for (.+?)\?/))) {
      return { kind: 'pay', title: 'Pay ' + m[1], primary: 'Approve payment', amount: m[1],
        facts: [['To', m[2]], ['For', m[3]], ['Amount', m[1], 'total']] };
    }
    if ((m = s.match(/^May I accept (.+?) from (.+?) for (\d[\d.,]* [A-Z]{3})\?/))) {
      return { kind: 'accept', title: 'Accept ' + m[1], primary: 'Approve', amount: m[3],
        facts: [['From', m[2]], ['Fee', m[3], 'total']] };
    }
    if ((m = s.match(/^(.+?) asks for (\w+) of your statements: (.+?)\. They would use them for (.+?), keep them for (.+?) and pass them on only to (.+?)\.(?: .+?\.)? May I share them\?/))) {
      return { kind: 'share', title: 'Share ' + m[2] + ' statements', primary: 'Approve sharing',
        facts: [['With', m[1]], ['What', m[3]], ['Used for', m[4]], ['Kept for', m[5]], ['Passed on to', m[6]]] };
    }
    if ((m = s.match(/^(.+?) asks for (.+?) for (.+?)\. (?:.*?)May I send it\?/))) {
      return { kind: 'send', title: 'Send ' + m[2].replace(/^.+?['’]s /, 'your '), primary: 'Approve sending',
        facts: [['To', m[1]], ['What', m[2]], ['Used for', m[3]]] };
    }
    return { kind: 'other', title: 'Approve this action', primary: 'Approve', facts: [] };
  };

  // Each ask, paired with the answer that follows it (if the run has one).
  P.asks = function (t) {
    var ev = t.events || [];
    var out = [];
    var open = null;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.kind === 'ask-principal') { open = { ask: i, reply: null }; out.push(open); }
      else if (e.kind === 'principal-reply' && open && open.reply == null) open.reply = i;
    }
    return out;
  };

  P.declined = function (e) {
    return /^Declines/.test(e.caption || '') || /^No\b/.test((e.chat && e.chat.text) || '');
  };

  // The gate checks that led to an ask: the run of outbound checks just before it.
  P.whyChecks = function (t, askIdx) {
    var ev = t.events;
    var me = ev[askIdx].agent;
    var out = [];
    for (var k = askIdx - 1; k >= 0; k--) {
      var e = ev[k];
      if (e.agent !== me || e.part !== 'outbound-gate' || (e.kind !== 'check' && e.kind !== 'decision')) break;
      if (e.kind === 'check') out.unshift(e);
    }
    return out;
  };

  // Steps between a face-check ask and its answer: the identity provider's signed statement.
  P.faceProgress = function (t, pair, idx) {
    var ev = t.events;
    var end = pair.reply == null ? ev.length - 1 : pair.reply - 1;
    var by = null;
    var seen = false;
    var admitted = false;
    for (var k = pair.ask + 1; k <= Math.min(end, idx); k++) {
      var e = ev[k];
      var m = String(e.caption || '').match(/^(.+?)['’]s identity approval statement/);
      if (m) { seen = true; by = by || m[1]; if (e.kind === 'decision' && (e.outcome === 'admit' || e.verdict === 'pass')) admitted = true; }
    }
    return { seen: seen, by: by, admitted: admitted };
  };

  // The whole screen for one moment of the run.
  P.model = function (t, idx, opt) {
    opt = opt || {};
    var ev = t.events || [];
    idx = Math.max(0, Math.min(ev.length - 1, idx));
    var agentId = P.principalAgent(t);
    var mandate = P.mandate(t, agentId);
    var pairs = P.asks(t);
    var byAsk = {};
    var byReply = {};
    pairs.forEach(function (p) { byAsk[p.ask] = p; if (p.reply != null) byReply[p.reply] = p; });
    var feed = [];
    for (var k = 0; k <= idx; k++) {
      var e = ev[k];
      if (e.chat) {
        var item = { type: 'bubble', who: e.chat.who === 'principal' ? 'principal' : 'agent', text: P.displayText(t, e.chat.text), i: k, now: k === idx };
        feed.push(item);
        if (e.kind === 'ask-principal' && byAsk[k]) {
          var p = byAsk[k];
          var answered = p.reply != null && p.reply <= idx;
          feed.push({ type: 'ask-chip', i: k, state: answered ? (P.declined(ev[p.reply]) ? 'declined' : 'approved') : 'waiting' });
        }
        if (e.kind === 'principal-reply') feed.push({ type: 'signed', i: k, declined: P.declined(e), caption: P.displayText(t, e.caption) });
      } else if (e.agent === agentId && e.kind === 'decision' && (e.outcome === 'stop' || e.outcome === 'refuse')) {
        feed.push({ type: 'stopped', i: k, outcome: e.outcome, caption: P.displayText(t, e.caption) });
      }
    }
    var overlay = null;
    var pending = null;
    pairs.forEach(function (p) { if (p.ask <= idx && (p.reply == null || idx < p.reply)) pending = p; });
    if (pending) {
      var askEv = ev[pending.ask];
      var text = P.displayText(t, (askEv.chat && askEv.chat.text) || askEv.caption);
      var c = P.classifyAsk(text);
      var why = P.whyChecks(t, pending.ask).map(function (c) {
        return Object.assign({}, c, { caption: P.displayText(t, c.caption) });
      });
      var asking = why.filter(function (x) { return x.verdict === 'ask-principal'; })[0] || null;
      var face = c.kind === 'face' ? P.faceProgress(t, pending, idx) : null;
      if (face && face.seen) {
        overlay = { type: 'face', key: 'face' + pending.ask, by: face.by, done: face.admitted };
      } else {
        overlay = {
          type: 'sheet', key: 'ask' + pending.ask, ask: c, text: text,
          caption: askEv.caption || '', why: why, asking: asking,
          digest: (String((askEv.chat && askEv.chat.text) || '').match(/digest: (sha-256:[0-9a-f]+)/) || [])[1] || null,
          unanswered: pending.reply == null && idx === ev.length - 1,
          meter: null,
        };
        if (c.kind === 'pay' || c.kind === 'accept') {
          var lim = P.limits(t).filter(function (l) { return l.label === 'Each payment'; })[0];
          var amt = c.amount;
          if (lim && amount(lim.value) > 0) {
            overlay.meter = { amount: amt, limit: lim.value, frac: Math.min(1, amount(amt) / amount(lim.value)) };
          }
        }
      }
    } else if (byReply[idx]) {
      var r = ev[idx];
      overlay = { type: 'confirm', key: 'reply' + idx, declined: P.declined(r), caption: r.caption || '', stronger: /attestation/.test(r.caption || '') };
    }
    return {
      agentId: agentId,
      principal: P.shortName(opt.principal),
      agentName: opt.agentName || 'The agent',
      mandate: mandate,
      limits: P.limits(t),
      feed: feed,
      overlay: overlay,
      autoTab: mandate && idx === mandate.i ? 'mandate' : 'chat',
      now: opt.stepTitle ? opt.stepTitle(idx) : null,
      atEnd: idx === ev.length - 1,
      idx: idx,
    };
  };

  // ---- Drawing -------------------------------------------------------------------------

  var IC = {
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    face: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 15V9a3 3 0 0 1 3-3h6M33 6h6a3 3 0 0 1 3 3v6M42 33v6a3 3 0 0 1-3 3h-6M15 42H9a3 3 0 0 1-3-3v-6"/><path d="M17 18v3M31 18v3M24 18v8h-2M18 32c3.5 3 8.5 3 12 0"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 8.5 7 7"/></svg>',
  };
  var GLYPH = { pass: ['pass', '✓'], 'ask-principal': ['ask', '?'], 'ask-more': ['ask', '?'], fail: ['fail', '×'] };

  function illus(text) { return '<span class="ph-illus" title="' + esc(text) + '">Illustrative</span>'; }

  function feedHtml(m) {
    if (!m.feed.length) return '<p class="ph-empty">Nothing has been put to ' + esc(m.principal) + ' yet in this run.</p>';
    var avatar = '<span class="ph-avatar" aria-hidden="true">' + esc(m.agentName.charAt(0)) + '</span>';
    return m.feed.map(function (f) {
      if (f.type === 'bubble') {
        if (f.who === 'principal') return '<div class="ph-msg user' + (f.now ? ' now' : '') + '"><div class="ph-bubble">' + esc(f.text) + '</div></div>';
        return '<div class="ph-msg agent' + (f.now ? ' now' : '') + '">' + avatar + '<div class="ph-agent-text">' + esc(f.text) + '</div></div>';
      }
      if (f.type === 'ask-chip') {
        var label = f.state === 'approved' ? 'Approved' : f.state === 'declined' ? 'Declined' : 'Needs your OK';
        var cls = f.state === 'approved' ? 'go' : f.state === 'declined' ? 'stop' : 'ask';
        return '<div class="ph-indent"><span class="ph-tag ' + cls + '">' + label + '</span></div>';
      }
      if (f.type === 'signed') {
        return '<div class="ph-seal-line">' + IC.lock + '<span>' + (f.declined ? 'Your answer was signed on this phone' : 'Signed on this phone, for this exact action') + '</span></div>';
      }
      if (f.type === 'stopped') {
        return '<div class="ph-card ph-stopped">' + IC.stop + '<div><strong>' + (f.outcome === 'refuse' ? 'Refused' : 'Stopped') + '</strong><p>' + esc(f.caption) + '</p></div></div>';
      }
      return '';
    }).join('');
  }

  function mandateHtml(m) {
    var h = '<div class="ph-screen-page"><h3>What ' + esc(m.agentName.replace(/^The /, 'the ')) + ' can do</h3>';
    if (!m.mandate) return h + '<p class="ph-lead">This run has no mandate record.</p></div>';
    h += '<p class="ph-lead">' + esc(m.principal) + ' signed these rules with their own key' + (m.mandate.until ? '. They hold until ' + esc(m.mandate.until) : '') + '.</p>';
    var own = m.mandate.rules.filter(function (r) { return r.own === true; });
    var ask = m.mandate.rules.filter(function (r) { return r.own === false; });
    var other = m.mandate.rules.filter(function (r) { return r.own === null; });
    function list(title, rows, cls) {
      if (!rows.length) return '';
      return '<h4>' + title + '</h4><ul class="ph-list">' + rows.map(function (r) {
        return '<li><span class="ph-oglyph ' + cls + '" aria-hidden="true"></span><span>' + esc(r.what) + '</span></li>';
      }).join('') + '</ul>';
    }
    h += list('On its own', own, 'go') + list('Asks you first', ask, 'ask') + list('Other rules', other, '');
    if (m.limits.length) {
      h += '<h4>Spending limits</h4><dl class="ph-facts">' + m.limits.map(function (l) {
        return '<dt>' + esc(l.label) + '</dt><dd>' + esc(l.value) + '</dd>';
      }).join('') + '</dl><p class="ph-small">As the agent quoted them in this run.</p>';
    }
    return h + '</div>';
  }

  function sheetHtml(o, m) {
    var a = o.ask;
    var h = '<div class="ph-scrim"></div><div class="ph-sheet" role="dialog" aria-label="' + esc(a.title) + '"><div class="ph-handle"></div>';
    h += '<div class="ph-sheet-seal">' + IC.shield + esc(m.agentName) + ' needs your OK</div>';
    h += '<h3>' + esc(a.title) + '</h3><p class="ph-reason">' + esc(o.text) + '</p>';
    if (o.meter) {
      h += '<div class="ph-meter"><div class="bar"><div class="fill" style="width:' + Math.round(o.meter.frac * 100) + '%"></div></div>' +
        '<div class="labels"><span>' + esc(o.meter.amount) + '</span><span>Limit ' + esc(o.meter.limit) + ' each payment</span></div></div>';
    }
    if (a.facts.length || o.digest) {
      h += '<dl class="ph-facts ruled">' + a.facts.map(function (f) {
        return '<dt>' + esc(f[0]) + '</dt><dd' + (f[2] ? ' class="total"' : '') + '>' + esc(trimDot(f[1])) + '</dd>';
      }).join('') + (o.digest ? '<dt>Bound to</dt><dd class="mono">' + esc(o.digest.slice(0, 20)) + '…</dd>' : '') + '</dl>';
    }
    if (o.unanswered) {
      h += '<p class="ph-note-inline">The run ends here, before ' + esc(m.principal) + ' answers.</p>';
    }
    h += '<div class="ph-actions"><button type="button" class="ph-btn primary" disabled>' + esc(a.primary) + '</button>' +
      '<button type="button" class="ph-btn text" disabled>Not now</button></div>';
    h += '<p class="ph-small center">Buttons are inert in a replay: ' + esc(m.principal) + '\'s answer comes from the recorded run. Step on to see it.</p>';
    if (o.why.length) {
      h += '<details class="ph-why"><summary>Why am I being asked?</summary><ul class="ph-checklist">';
      var na = 0;
      o.why.forEach(function (c) {
        var g = GLYPH[c.verdict];
        if (!g) { na++; return; }
        var name = (AX.checkById && AX.checkById[c.check] && AX.checkById[c.check].name) || c.check;
        h += '<li class="' + g[0] + '"><span class="ph-glyph ' + g[0] + '" aria-hidden="true">' + g[1] + '</span><span><span class="cname">' + esc(name) + '</span> ' + esc(c.caption) + '</span></li>';
      });
      h += '</ul>' + (na ? '<p class="ph-small">' + na + ' more ' + (na === 1 ? 'check does' : 'checks do') + ' not apply here.</p>' : '');
      h += '<p class="ph-small">' + esc(o.caption) + ' The gate wrote this request from the action itself, not the AI model.</p></details>';
    }
    return h + '</div>';
  }

  function faceHtml(o, m) {
    var by = o.by || 'The identity provider';
    return '<div class="ph-device" role="dialog" aria-label="Face check"><div class="ph-panel">' +
      '<div class="ph-face' + (o.done ? ' done' : '') + '">' + (o.done ? '' : '<div class="scan"></div>') + IC.face + '</div>' +
      '<strong>' + (o.done ? 'Face check complete' : 'Hold still') + '</strong>' +
      '<p>' + esc(o.done ? by + ' sent a signed statement that it is ' + m.principal + '. ' + m.agentName + ' checked it before using it.' : by + ' is checking it is ' + m.principal + '.') + '</p>' +
      illus('The run records the identity provider\'s signed statement and the checks on it. The camera step is drawn, not recorded.') +
      '</div></div>';
  }

  function confirmHtml(o, m) {
    return '<div class="ph-device" role="dialog" aria-label="Confirm with Face ID"><div class="ph-panel">' +
      '<div class="ph-print">' + IC.face + '</div>' +
      '<strong>' + (o.declined ? 'Sign your answer: decline' : 'Approve with Face ID') + '</strong>' +
      '<p>' + esc('Face ID unlocks a passkey kept on this phone. It signs ' + m.principal + '\'s answer, bound to this exact action' + (o.stronger ? ', and the face check statement goes with it.' : '.')) + '</p>' +
      illus('The run records the signed answer. How the phone unlocks the signing key is drawn as a passkey prompt.') +
      '</div></div>';
  }

  var lastOverlay = null;
  // opts: { tab: 'chat' | 'mandate' | null }
  P.render = function (host, m, opts) {
    var tab = (opts && opts.tab) || m.autoTab;
    var h = '<div class="phone"><div class="ph-screen">';
    h += '<div class="ph-top"><span class="ph-avatar lg" aria-hidden="true">' + esc(m.agentName.charAt(0)) + '</span><div class="ph-title"><strong>' + esc(m.agentName) + '</strong><span>acts for ' + esc(m.principal) + '</span></div></div>';
    h += '<div class="ph-tabs" role="group" aria-label="Phone screen"><button type="button" data-ph-tab="chat" aria-pressed="' + (tab === 'chat') + '">Chat</button><button type="button" data-ph-tab="mandate" aria-pressed="' + (tab === 'mandate') + '">What it can do</button></div>';
    h += '<div class="ph-body">' + (tab === 'mandate' ? mandateHtml(m) : feedHtml(m)) + '</div>';
    if (m.now) h += '<div class="ph-now"><span class="ph-dot' + (m.atEnd ? ' done' : '') + '"></span><span>' + esc(m.atEnd ? 'Finished: ' + trimDot(m.now) : trimDot(m.now)) + '</span></div>';
    h += '<div class="ph-composer" aria-hidden="true">Message ' + esc(m.agentName.replace(/^The /, 'the ')) + '</div>';
    var o = m.overlay;
    if (o && tab === 'chat') {
      if (o.type === 'sheet') h += sheetHtml(o, m);
      else if (o.type === 'face') h += faceHtml(o, m);
      else if (o.type === 'confirm') h += confirmHtml(o, m);
    }
    h += '</div></div>';
    host.innerHTML = h;
    var key = o && tab === 'chat' ? o.key : null;
    var phone = host.querySelector('.phone');
    if (key && key !== lastOverlay) phone.classList.add('enter');
    lastOverlay = key;
    var body = host.querySelector('.ph-body');
    if (body && tab === 'chat') body.scrollTop = body.scrollHeight;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})();
