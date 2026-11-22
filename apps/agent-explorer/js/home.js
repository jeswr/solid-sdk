// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// The home page: what Answerable is for, what this site shows, and the narrated walkthrough.
// Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var R = (AX.render = AX.render || {});

  // Chapters of the walkthrough video (seconds, title). Kept beside the captions in media/.
  var CHAPTERS = [
    [0, 'Agents that act for us'], [12, 'The goals'], [36, 'Two gates around a black box'],
    [61, 'The message and its layers'], [88, 'The explorer'], [117, 'Who is on the other end'],
    [132, 'A bank asks for more'], [158, 'Asking Sam'], [186, 'RDF at every gate'],
    [201, 'Payment is a contract'], [243, 'Swap a layer'], [256, 'When things go wrong'],
    [278, 'Seventy use cases'], [305, 'Requirements and specifications'],
    [322, 'Starting from email'], [334, 'Try it'],
  ];

  function clock(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function counts() {
    var real = (AX.traces || []).filter(function (t) { return !t.isFixture; }).length;
    var uc = AX.data.useCases && AX.data.useCases.useCases ? AX.data.useCases.useCases.length : 0;
    var specs = (AX.data.specs || []).length;
    return { real: real, useCases: uc, specs: specs };
  }

  var GUIDE = [
    { view: 'explore', title: 'Explore', text: 'Step through a real run, check by check. Swap one layer, such as how the agents pay or prove who they are, and see what changes.' },
    { view: 'architecture', title: 'Architecture', text: 'The parts of an agent: the core that thinks, and the two gates that decide what comes in and what goes out.' },
    { view: 'message', title: 'Message', text: 'What a verifiable message carries, layer by layer, and what a receiver can check in it.' },
    { view: 'layers', title: 'Layers', text: 'The ' + AX.orderedLayers.length + ' questions two agents must agree on, and the choices for each.' },
    { view: 'usecases', title: 'Use cases', text: 'Seventy situations, from a mortgage to a hostile counterparty, and how the design copes with each.' },
    { view: 'specs', title: 'Specs', text: 'The draft specifications, with numbered clauses you can cite.' },
    { view: 'tests', title: 'Evaluation', text: 'How the design is being tested, and what the tests show so far.' },
    { view: 'get-an-agent', title: 'Get an agent', text: 'Two routes to an agent of your own, and what is ready today.' },
  ];

  R.home = function (root) {
    var n = counts();
    var have = {};
    (AX.views || []).forEach(function (v) { have[v.id] = true; });
    var h = '<div class="page home">';
    h += '<header><p class="eyebrow">Answerable</p><h1>Agents you can hold to account</h1>';
    h += '<p class="lede">Software agents are starting to act for people: asking a bank for a mortgage, booking a viewing, paying a fee. Answerable is a design for doing that safely. Every message an agent sends can be checked, every action stays inside what its person allowed, and every step is recorded so that someone can answer for it.</p></header>';

    h += '<figure class="home-video">';
    h += '<video controls preload="metadata" playsinline poster="media/answerable-walkthrough-poster.jpg" src="media/answerable-walkthrough.mp4">';
    h += '<track kind="captions" srclang="en" label="English" src="media/answerable-walkthrough.vtt" default>';
    h += '</video>';
    h += '<figcaption>A walkthrough of the design and this site, recorded against the current runs. The voice is a synthetic stand-in.</figcaption>';
    h += '</figure>';
    h += '<details class="home-chapters"><summary>Chapters</summary><ol>' + CHAPTERS.map(function (c) {
      return '<li><button type="button" class="linkish" data-at="' + c[0] + '"><span class="t">' + clock(c[0]) + '</span>' + esc(c[1]) + '</button></li>';
    }).join('') + '</ol></details>';

    h += '<h2>The goals</h2><div class="cards">';
    h += '<div class="card"><h3>Check what comes in</h3><p>Before anything reaches the part that thinks, an agent asks: is this intact, who sent it, were they allowed to, on what terms, and is it good enough to rely on?</p></div>';
    h += '<div class="card"><h3>Decide what goes out</h3><p>Before anything leaves, it asks: is this inside my person\'s instructions, to the right party, no more than needed, and within the limits? If not, it stops or asks the person.</p></div>';
    h += '<div class="card"><h3>Keep a record</h3><p>Each agent keeps a signed record of what it did and why it was allowed to, so that when something goes wrong a regulator or a court can see who answers for it.</p></div>';
    h += '<div class="card"><h3>Work with what exists</h3><p>It starts from email, the web and existing standards, and moves up to structured, signed messages when both sides can. No one has to sign up to a single platform.</p></div>';
    h += '</div>';

    h += '<h2>What this site is</h2>';
    h += '<div class="prose"><p>A way to look inside a working reference agent. The runs you can step through are real: the reference agent produced them, and each check you see is one it actually made. ';
    if (n.real) h += 'There are ' + n.real + ' recorded runs' + (n.useCases ? ' across ' + n.useCases + ' use cases' : '') + '. ';
    h += 'Everyone in them is fictional, and both sides of each exchange run the same code, so the runs show what the design does, not that separate products work together.</p>';
    h += '<p>Beside each run, Sam\'s phone shows what the person sees: the chat with their agent, the rules it may follow on its own, and each request for approval, with what is asked, of whom and on what terms. Approving is confirmed with Face ID on the phone. The phone is drawn from the run\'s own records; the few prompts a run cannot record, such as the camera step of a face check, are marked as illustrative.</p>';
    h += '<p>It is a research preview. The specifications are drafts, and the reference agent has not had an outside security review.</p></div>';

    h += '<h2>Where to go next</h2><div class="cards home-guide">';
    GUIDE.filter(function (g) { return have[g.view]; }).forEach(function (g) {
      h += '<a class="card linkcard" href="' + AX.buildHash(g.view, {}) + '"><h3>' + esc(g.title) + '</h3><p>' + esc(g.text) + '</p></a>';
    });
    h += '</div>';
    h += '<p class="start-links"><a class="btn primary" href="' + AX.buildHash('explore', {}) + '">Step through a real run</a>';
    if (AX.tour) h += '<button type="button" class="btn" id="home-tour">Take the guided tour</button>';
    h += '<a class="btn" id="home-app" href="app/" hidden>Try the app</a>';
    h += '<a class="btn" href="paper/">Read the paper</a>';
    h += '</p>';
    h += '</div>';
    root.innerHTML = h;

    var video = root.querySelector('video');
    root.querySelectorAll('.home-chapters [data-at]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!video) return;
        video.currentTime = Number(b.dataset.at);
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      });
    });
    // The public site hosts the Errand app at app/ when it was built with it; elsewhere the
    // link stays hidden.
    var appLink = root.querySelector('#home-app');
    if (appLink) AX.probeErrandApp().then(function (available) { if (available) appLink.hidden = false; });
    var tb = root.querySelector('#home-tour');
    if (tb) tb.addEventListener('click', function () { AX.tour.start(); });
  };
})();
