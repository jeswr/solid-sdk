// AUTHORED-BY Codex GPT-6.2 Sol
// Classic script, with a pure renderer for the static site tests.
(function () {
  'use strict';
  var errandLink = '<a class="btn" href="app/">Open the Errand demo</a>';

  function html(opts) {
    opts = opts || {};
    var mcp = opts.mcp ? '<a class="btn" href="#/explore?scenario=mortgage-main&amp;config=transport-mcp">Step through a run over MCP</a>' : '';
    var a2a = opts.a2a ? '<a class="btn" href="#/explore?scenario=mortgage-main&amp;config=transport-a2a">Step through a run over A2A</a>' : '';
    var demo = opts.errand ? errandLink : 'The Errand demo is hosted with the public copy of this site.';
    return `<div class="page get-an-agent">
      <header>
        <p class="eyebrow">Get an agent</p>
        <h1>Two routes to an agent of your own</h1>
        <p class="lede">An Answerable agent acts for you inside limits you set, checks what it receives, and keeps a record you can show. There are two ways to get one. Neither is ready for everyday use yet, and this page says exactly what exists today.</p>
      </header>
      <p class="start-preview"><strong>Research preview.</strong> Nothing here is live for real users. There is no sign-up, this page collects nothing, and every person, shop and bank in the demos is fictional.</p>
      <div class="cards two routes">
        <section class="card">
          <h2>Route 1. Connect the assistant you already use.</h2>
          <p class="route-status"><span class="status next">Being built</span></p>
          <p>Keep the assistant you have. An adapter sits between it and the outside world. The assistant still does the thinking. The adapter runs the two gates: it checks what comes in, decides what may go out, holds the keys and keeps the record.</p>
          <p>The adapter is not finished. These parts exist today:</p>
          <ul class="plain">
            <li><strong>A pod connector.</strong> A Model Context Protocol server that lets an assistant read, and if you allow it write, a personal data store. It is source code, not a hosted service, and it does not yet run the two gates.</li>
            <li><strong>Message carriage over MCP and A2A.</strong> The reference agent can already carry signed messages as tool calls and as agent-to-agent tasks. You can step through recorded runs of both.</li>
            <li><strong>What is missing.</strong> One package that joins these and puts both gates around an assistant.</li>
          </ul>
          ${mcp || a2a ? '<div class="start-links">' + mcp + a2a + '</div>' : ''}
          <p class="small muted">You will need: an assistant that can use outside tools.</p>
        </section>
        <section class="card">
          <h2>Route 2. Use a hosted agent.</h2>
          <p class="route-status"><span class="status later">Demo only</span></p>
          <p>Someone runs the agent for you. You say what it may do on its own, set spending limits, and approve the rest on your own device. Any provider could offer this, because the specifications are open. None does yet.</p>
          <p>What you can try today is Errand, a demo of what a hosted agent could feel like. It runs in your browser. The shops, the people and the money are made up. Nothing is bought, nothing is sent, and no account is created.</p>
          <div class="start-links" id="get-an-agent-demo">${demo}</div>
          <p class="small muted">You will need: nothing. There is nothing to sign up to.</p>
        </section>
      </div>
      <h2>For builders. Run the reference agent.</h2>
      <p><span class="status doing">Source, research grade</span></p>
      <p class="prose">The reference agent behind this site is open source, and it produced the runs you can step through here. It is for people who build agents. It has not had an outside security review.</p>
      <p class="small muted">You will need: Node and a terminal.</p>
      <h2>What setting up will involve.</h2>
      <div class="prose">
        <p>Whichever route you take, three things happen:</p>
        <ol class="plain">
          <li><strong>Say who the agent acts for.</strong> You, with a key only you control.</li>
          <li><strong>Say what it may do alone.</strong> For example: ask for quotes, but never pay more than a limit you choose.</li>
          <li><strong>Approve the rest.</strong> Anything outside those rules comes to you, with what is asked, by whom and on what terms.</li>
        </ol>
        <p>Errand shows all three with made-up data.</p>
      </div>
      <h2>What this page does not offer.</h2>
      <ul class="plain prose">
        <li>No sign-up form. We collect no name, email address or payment detail here.</li>
        <li>No live service. No agent on this site acts for a real person.</li>
        <li>No promise that separate products already work together. Both sides of every recorded run use the same code.</li>
      </ul>
      <div class="start-links">
        <a class="btn" href="#/start">What the footer on an agent's email means</a>
        <a class="btn" href="#/specs?doc=20-baseline">Starting from email, in the baseline</a>
        <a class="btn" href="#/specs?doc=40-conformance">What an agent must show to use the name</a>
      </div>
    </div>`;
  }

  var page = { html: html };
  if (typeof module !== 'undefined' && module.exports) module.exports = page;
  if (typeof window === 'undefined') return;

  var AX = window.AX;
  AX.getAnAgent = page;
  AX.probeErrandApp = function () {
    if (!window.fetch || !/^https?:$/.test(window.location.protocol)) return Promise.resolve(false);
    return window.fetch('app/index.html').then(function (response) {
      return response.ok ? response.text() : '';
    }).then(function (text) { return /<title>Errand<\/title>/.test(text); }).catch(function () { return false; });
  };
  (AX.render = AX.render || {})['get-an-agent'] = function (root) {
    root.innerHTML = html({
      mcp: AX.traceByKey['mortgage-main--transport-mcp'],
      a2a: AX.traceByKey['mortgage-main--transport-a2a'],
    });
    var demo = root.querySelector('#get-an-agent-demo');
    AX.probeErrandApp().then(function (available) {
      if (available && root.contains(demo)) demo.innerHTML = errandLink;
    });
  };
})();
