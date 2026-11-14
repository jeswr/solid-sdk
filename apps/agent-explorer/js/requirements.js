// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// The Requirements view, driven entirely by model.requirements. Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var R = (AX.render = AX.render || {});
  var STATUS = { shown: 'Shown', partly: 'Partly', 'by-design': 'By design' };

  function whereChips(ids) {
    return '<div class="chips">' + (ids || []).map(function (id) {
      var r = AX.resolveId(id);
      if (!r) return '<span class="risk-chip" title="Not found in the model">' + esc(id) + '</span>';
      return '<a class="risk-chip" href="' + r.href + '" title="' + esc(r.kind) + '">' + esc(r.name) + '</a>';
    }).join('') + '</div>';
  }
  // Explore link for a risk: first event whose check or part is one of the "where" ids.
  function seeItHref(risk) {
    var t = AX.traceByKey[risk.trace];
    if (!t) return null;
    var e2 = t.summary.requirements[risk.id];
    if (!e2) return null;
    return AX.buildHash('explore', { scenario: t.scenario.id, config: t.configuration.id, step: e2.step, seq: e2.seq, level: 'checks' });
  }
  function sourceClass(status) {
    var s = (status || '').toLowerCase();
    if (/^(recommendation|standard)$/.test(s)) return 'std';
    if (/draft|community|research/.test(s)) return 'draft';
    return '';
  }

  R.requirements = function (root, p) {
    var Q = AX.model.requirements || {};
    var sel = p.select || '';
    var byId = {};
    (Q.owaspAgentic || []).forEach(function (r) { byId[r.id] = r; });
    var srcById = {};
    (Q.sources || []).forEach(function (s) { srcById[s.id] = s; });
    var h = '<div class="page">';
    h += '<header><p class="eyebrow">Requirements</p><h1>How the design meets current guidance</h1>' + (Q.note ? '<p class="lede">' + esc(Q.note) + '</p>' : '') + '</header>';
    if (Q.principle) {
      h += '<section class="principle"><h2>' + esc(Q.principle.title) + '</h2><p>' + esc(Q.principle.text) + '</p>';
      if (Q.principle.sources && Q.principle.sources.length) {
        h += '<p class="small muted" style="margin-top:8px">' + Q.principle.sources.map(function (id) {
          var s = srcById[id];
          return s ? '<a href="#src-' + esc(id) + '" data-src="' + esc(id) + '">' + esc(s.name) + '</a>' : esc(id);
        }).join('; ') + '</p>';
      }
      h += '</section>';
    }
    h += '<h2>The ' + (Q.owaspAgentic || []).length + ' OWASP agentic risks, and our answers</h2><div class="risks">';
    (Q.owaspAgentic || []).forEach(function (r) {
      h += '<article class="risk' + (sel === r.id ? ' sel' : '') + '" id="risk-' + esc(r.id) + '">';
      h += '<div class="risk-head"><span class="risk-id">' + esc(r.id) + '</span><h3>' + esc(r.name) + '</h3><span class="status ' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span></div>';
      h += '<p class="risk-text"><span class="lbl">Risk</span>' + esc(r.risk) + '</p>';
      h += '<p><span class="lbl">Our answer</span>' + esc(r.answer) + '</p>';
      if (r.gap) h += '<p class="gap">' + esc(r.gap) + '</p>';
      h += '<div><span class="lbl">Where</span>' + whereChips(r.where) + '</div>';
      if (r.trace) {
        var href = seeItHref(r);
        h += '<div class="foot">' + (href ? '<a class="btn small primary see-it" href="' + href + '">See it happen</a>' : '<span class="small muted see-it">Trace not loaded yet</span>') + '</div>';
      }
      h += '</article>';
    });
    h += '</div>';
    if (Q.added && Q.added.length) {
      h += '<h2>Requirements we added</h2><div class="table-wrap"><table class="data"><thead><tr><th>Requirement</th><th>What it says</th><th>Lives in</th><th>Answers</th></tr></thead><tbody>';
      Q.added.forEach(function (a) {
        h += '<tr><td><strong>' + esc(a.name) + '</strong></td><td style="min-width:260px">' + esc(a.text) + '</td><td>' + whereChips([a.check]) + '</td><td><div class="chips">' + (a.from || []).map(function (id) {
          var r = byId[id];
          return '<a class="risk-chip" href="' + AX.buildHash('requirements', { select: id }) + '"' + (r ? ' title="' + esc(r.name) + '"' : '') + '><b>' + esc(id) + '</b></a>';
        }).join('') + '</div></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    if (Q.terms && Q.terms.length) {
      h += '<h2>Words we use and the standard words</h2><div class="table-wrap"><table class="data"><thead><tr><th>Ours</th><th>Standard</th><th>Note</th></tr></thead><tbody>';
      Q.terms.forEach(function (t) {
        h += '<tr><td><strong>' + esc(t.ours) + '</strong></td><td>' + esc(t.standard) + '</td><td class="muted">' + esc(t.note) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    if (Q.sources && Q.sources.length) {
      h += '<h2>Sources</h2><div class="table-wrap"><table class="data"><thead><tr><th>Source</th><th>Publisher</th><th>Status</th><th>Link</th></tr></thead><tbody>';
      Q.sources.forEach(function (s) {
        h += '<tr id="src-' + esc(s.id) + '"><td><strong>' + esc(s.name) + '</strong>' + (s.date ? '<div class="small muted">' + esc(s.date) + '</div>' : '') + '</td><td>' + esc(s.publisher) + '</td><td><span class="src-status ' + sourceClass(s.status) + '">' + esc(s.status) + '</span></td><td>' +
          (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">Open</a>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';
    root.innerHTML = h;
    root.querySelectorAll('[data-src]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var t = document.getElementById('src-' + a.getAttribute('data-src'));
        if (t) t.scrollIntoView({ block: 'center' });
      });
    });
  };
})();
