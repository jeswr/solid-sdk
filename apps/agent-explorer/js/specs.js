// AUTHORED-BY Claude Opus 5.5
// The Specifications view: spec documents bundled from docs/specs/agent/*.md. Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var R = (AX.render = AX.render || {});
  var GROUPS = [
    ['0', 'Overview and core'],
    ['1', 'Layers'],
    ['2', 'Baseline'],
    ['3', 'Profiles'],
    ['4', 'Conformance'],
    ['5', 'Requirements'],
  ];

  function docHref(id, at) { return AX.buildHash('specs', { doc: id, at: at }); }

  R.specs = function (root, p) {
    var specs = AX.data.specs || [];
    if (!specs.length) {
      root.innerHTML = '<div class="page"><header><p class="eyebrow">Specifications</p><h1>Specifications are being written.</h1><p class="lede">The documents appear here when they are bundled.</p></header></div>';
      return;
    }
    var ids = specs.map(function (s) { return s.id; });
    var doc = specs.filter(function (s) { return s.id === p.doc; })[0] || specs[0];
    var nav = '<nav class="spec-nav" aria-label="Specification documents">';
    var grouped = {};
    specs.forEach(function (s) {
      var g = /^\d/.test(s.id) ? s.id[0] : '?';
      (grouped[g] = grouped[g] || []).push(s);
    });
    GROUPS.concat([['?', 'Other']]).forEach(function (g) {
      var list = grouped[g[0]];
      if (!list) return;
      nav += '<h3>' + esc(g[1]) + '</h3><ul>' + list.map(function (s) {
        return '<li><a href="' + docHref(s.id) + '"' + (s.id === doc.id ? ' aria-current="page"' : '') + '>' + esc(s.title) + '</a></li>';
      }).join('') + '</ul>';
    });
    nav += '</nav>';
    var r = AX.markdown(doc.markdown, {
      anchor: function (id) { return docHref(doc.id, id); },
      link: function (href) {
        if (/^(https?:|mailto:)/i.test(href)) return href;
        if (href.charAt(0) === '#') return docHref(doc.id, href.slice(1));
        // Links to sibling spec documents: "11-data-access.md#scope" or "./11-data-access.md".
        var m = href.match(/^(?:\.\/)?([\w.-]+?)\.md(?:#(.*))?$/);
        if (m && ids.indexOf(m[1]) >= 0) return docHref(m[1], m[2]);
        return href;
      },
    });
    root.innerHTML = '<div class="page"><div class="specs">' + nav + '<article class="md" id="spec-doc">' + r.html + '</article></div></div>';
  };
})();
