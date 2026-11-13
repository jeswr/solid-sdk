// AUTHORED-BY Claude Opus 5.5
// Guided tours: data in tours/*.json, bundled. Each stop applies a hash state and spotlights a target.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var layer = document.getElementById('tour-layer');
  var T = { tour: null, i: 0 };
  var spot = null;
  var card = null;
  var repositionTimer = null;

  function tours() { return AX.data.tours || []; }
  function find(id) { return tours().filter(function (t) { return t.id === id; })[0] || tours()[0]; }

  function resolveTarget(target) {
    if (!target) return null;
    var el = null;
    try { el = document.querySelector('[data-anchor="' + target + '"]'); } catch (e) { el = null; }
    if (!el) { try { el = document.querySelector(target); } catch (e2) { el = null; } }
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return el;
  }

  function place() {
    if (!T.tour || !card) return;
    var stop = T.tour.stops[T.i];
    var el = resolveTarget(stop.target);
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (!el) {
      spot.className = 'tour-spot none';
      spot.style.cssText = '';
      card.style.left = Math.max(16, (vw - card.offsetWidth) / 2) + 'px';
      card.style.top = Math.max(16, (vh - card.offsetHeight) / 2) + 'px';
      return;
    }
    var r = el.getBoundingClientRect();
    var pad = 6;
    var x = Math.max(4, r.left - pad);
    var y = Math.max(4, r.top - pad);
    var w = Math.min(vw - 8, r.right + pad) - x;
    var h = Math.min(vh - 8, r.bottom + pad) - y;
    spot.className = 'tour-spot';
    spot.style.left = x + 'px';
    spot.style.top = y + 'px';
    spot.style.width = w + 'px';
    spot.style.height = h + 'px';
    if (vw <= 760) return; // the card is docked at the bottom on phones
    var cw = card.offsetWidth;
    var ch = card.offsetHeight;
    var cx;
    var cy;
    if (vh - (y + h) >= ch + 16) { cy = y + h + 12; cx = x; }
    else if (y >= ch + 16) { cy = y - ch - 12; cx = x; }
    else if (vw - (x + w) >= cw + 16) { cx = x + w + 12; cy = y; }
    else if (x >= cw + 16) { cx = x - cw - 12; cy = y; }
    else { cx = (vw - cw) / 2; cy = vh - ch - 16; }
    cx = Math.max(16, Math.min(vw - cw - 16, cx));
    cy = Math.max(16, Math.min(vh - ch - 16, cy));
    card.style.left = cx + 'px';
    card.style.top = cy + 'px';
  }

  function show() {
    var stop = T.tour.stops[T.i];
    var hash = '#/' + (stop.view || 'explore') + (stop.state ? (stop.state.charAt(0) === '?' ? stop.state : '?' + stop.state) : '');
    if (AX.explore && AX.explore.stop) AX.explore.stop();
    AX.go(hash);
    var n = T.tour.stops.length;
    card.innerHTML = '<button type="button" class="tour-close" aria-label="Close the tour">&times;</button>' +
      '<p class="eyebrow">' + esc(T.tour.title) + '</p><h3 id="tour-title">' + esc(stop.title) + '</h3><p>' + esc(stop.text) + '</p>' +
      '<div class="tour-foot"><span class="tour-count">' + (T.i + 1) + ' of ' + n + '</span>' +
      '<button type="button" class="btn" data-tour="back"' + (T.i === 0 ? ' disabled' : '') + '>Back</button>' +
      '<button type="button" class="btn primary" data-tour="next">' + (T.i === n - 1 ? 'Finish' : 'Next') + '</button></div>';
    card.querySelector('.tour-close').addEventListener('click', stopTour);
    card.querySelector('[data-tour="back"]').addEventListener('click', function () { go(T.i - 1); });
    card.querySelector('[data-tour="next"]').addEventListener('click', function () { if (T.i === n - 1) stopTour(); else go(T.i + 1); });
    // Wait for the view to render, then bring the target into view and place the spotlight.
    setTimeout(function () {
      var el = resolveTarget(stop.target);
      if (el && el.scrollIntoView) {
        var r = el.getBoundingClientRect();
        if (window.innerWidth <= 760) el.scrollIntoView({ block: 'start' }); // the card is docked at the bottom
        else if (r.top < 60 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ block: 'center' });
      }
      place();
      var nb = card.querySelector('[data-tour="next"]');
      if (nb) nb.focus({ preventScroll: true });
    }, 120);
  }
  function go(i) {
    if (!T.tour) return;
    T.i = Math.max(0, Math.min(T.tour.stops.length - 1, i));
    show();
  }
  function onKey(e) {
    if (!T.tour) return;
    if (e.key === 'Escape') { stopTour(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { if (T.i < T.tour.stops.length - 1) go(T.i + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(T.i - 1); e.preventDefault(); }
  }
  function onMove() {
    clearTimeout(repositionTimer);
    repositionTimer = setTimeout(place, 30);
  }
  function startTour(id) {
    var t = find(id);
    if (!t || !t.stops || !t.stops.length) return;
    dismissInvite();
    T.tour = t;
    T.i = 0;
    layer.innerHTML = '<div class="tour-spot none"></div><div class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title"></div>';
    spot = layer.querySelector('.tour-spot');
    card = layer.querySelector('.tour-card');
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    AX.store.set('ax-invited', '1');
    show();
  }
  function stopTour() {
    T.tour = null;
    layer.innerHTML = '';
    spot = card = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    document.removeEventListener('scroll', onMove, true);
  }
  function dismissInvite() {
    var inv = document.getElementById('tour-invite');
    if (inv) inv.remove();
  }
  function maybeInvite() {
    if (!tours().length) { var b = document.getElementById('tour-btn'); if (b) b.hidden = true; return; }
    if (AX.store.get('ax-invited') === '1') return;
    if (/present=1/.test(AX.hash.cur)) return;
    var t = tours()[0];
    var inv = AX.el('<aside class="invite" id="tour-invite" aria-label="Guided tour"><h3>New here?</h3><p>' + esc(t.title) + ': ' + t.stops.length + ' short stops that explain what you are looking at.</p><div class="row-btns"><button type="button" class="btn primary" id="invite-go">Take the tour</button><button type="button" class="btn" id="invite-no">Not now</button></div></aside>');
    document.body.appendChild(inv);
    inv.querySelector('#invite-go').addEventListener('click', function () { startTour(t.id); });
    inv.querySelector('#invite-no').addEventListener('click', function () { AX.store.set('ax-invited', '1'); dismissInvite(); });
  }

  AX.tour = {
    start: startTour,
    stop: stopTour,
    go: go,
    active: function () { return !!T.tour; },
    index: function () { return T.i; },
    length: function () { return T.tour ? T.tour.stops.length : 0; },
    maybeInvite: maybeInvite,
  };
})();
