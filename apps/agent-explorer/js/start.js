// AUTHORED-BY Claude Fable 5.2
// The page behind the link in an agent's email footer (baseline BL-3 to BL-9): what the footer
// means, what a reader can do, and the routes to an agent of one's own. Classic script.
(function () {
  'use strict';
  var AX = window.AX;
  var esc = AX.esc;
  var R = (AX.render = AX.render || {});

  // What each route offers today. Statuses are stated plainly; nothing here is a product yet.
  var ROUTES = [
    {
      name: 'Add it to an assistant you already use',
      status: 'next', statusLabel: 'Being built',
      what: 'An adapter puts the two gates around the assistant you have. The assistant keeps doing the thinking. The gates check what comes in, decide what may go out, hold the keys and keep the record.',
      need: 'An assistant that can use outside tools.',
    },
    {
      name: 'Use a hosted agent',
      status: 'later', statusLabel: 'Not available yet',
      what: 'Someone runs the agent for you. You sign in, say what it may do, and approve what it asks you about. Any provider can offer this; the specifications are open.',
      need: 'Nothing but an email address.',
    },
    {
      name: 'Run your own',
      status: 'doing', statusLabel: 'Source, research grade',
      what: 'The reference agent behind this site is open source. The real runs you can step through here were produced by it. It is for people who build agents, and it has not had an outside security review.',
      need: 'Node and a terminal.',
    },
  ];

  var FOOTER = 'Sent by Sam\'s agent, an automated assistant acting for Sam. It is an Answerable agent: this message is signed, says what the agent is allowed to do, and is recorded. You can reply as normal. If you use an agent of your own, it can check all of this for you. Get one that is Answerable too: answerableagents.org';

  function mail() {
    var h = '<figure class="mail" aria-label="An example email from an agent, with its footer">';
    h += '<dl class="mail-head">';
    h += '<dt>From</dt><dd>Sam\'s agent &lt;agent@sam.example&gt;</dd>';
    h += '<dt>To</dt><dd>Lettings desk &lt;hello@harbourlets.example&gt;</dd>';
    h += '<dt>Subject</dt><dd>Viewing on Thursday</dd>';
    h += '<dt class="hdr">Agent-Description</dt><dd class="hdr">https://sam.example/agent.json</dd>';
    h += '</dl>';
    h += '<div class="mail-body"><p>Hello. Sam would like to view the flat on Marsh Lane on Thursday after 5 pm. Is a slot free?</p>';
    h += '<p class="mail-footer" id="start-footer">' + esc(FOOTER) + '</p></div>';
    h += '<div class="mail-att"><span class="chip">message.json</span><span class="small muted">the same request in structured, signed form</span></div>';
    h += '<figcaption>Everyone in this example is fictional. A person reads the body. An agent reads the attachment and the header, never the footer.</figcaption>';
    h += '</figure>';
    return h;
  }

  R.start = function (root) {
    var M = AX.model;
    var h = '<div class="page start">';
    h += '<header><p class="eyebrow">The link in the footer</p><h1>A message from someone\'s agent</h1>';
    h += '<p class="lede">Some emails end with a short footer saying they were sent by an Answerable agent. This page says what that means, what you can do about it, and how to get an agent of your own.</p></header>';

    h += '<p class="start-preview"><strong>Research preview.</strong> Answerable is a published design with a working reference agent. No route below is ready for everyday use yet, so for now the footer appears only in test runs.</p>';

    h += '<div class="start-grid">' + mail() + '<div>';
    h += '<h2 class="first">What the footer tells you</h2><ul class="start-list">';
    h += '<li><strong>Software sent it, for a named person.</strong> It does not pretend to be Sam.</li>';
    h += '<li><strong>It is signed.</strong> The attachment carries a signature that shows which agent sent it and that nothing changed on the way.</li>';
    h += '<li><strong>It says what the agent may do.</strong> Sam\'s instruction to the agent travels with the message, so you can see the agent is acting inside it.</li>';
    h += '<li><strong>It is recorded.</strong> Sam\'s agent keeps a record of what it sent and why it was allowed to.</li>';
    h += '</ul>';
    h += '<h3 class="sub">What it does not tell you</h3>';
    h += '<p class="prose">It does not say the message is safe, true or trustworthy. A footer is only words. Whether to rely on what the message says is for your own checks, or your own agent\'s.</p>';
    h += '</div></div>';

    h += '<h2>You can just reply</h2><div class="cards two">';
    h += '<div class="card"><h3>Nothing to install</h3><p>Answer the email as you would any other. The agent reads your reply and passes it on or answers it.</p></div>';
    h += '<div class="card"><h3>A plain reply commits nobody</h3><p>The agent treats ordinary text as conversation. It cannot take a sentence in an email as an offer, an acceptance, a payment or a consent. Those are only ever made in structured, signed form, or by the person.</p></div>';
    h += '</div>';

    h += '<h2>What an agent of your own would check</h2>';
    h += '<p class="lede">It reads the attachment, not the prose, and asks five questions in order before anything reaches the part that thinks.</p>';
    h += '<ol class="start-checks">' + (M.inboundChecks || []).map(function (c) {
      return '<li><a href="' + AX.buildHash('architecture', { select: c.id }) + '"><span class="qn">' + esc(c.name) + '</span></a><span class="qq">' + esc(c.question || c.summary || '') + '</span></li>';
    }).join('') + '</ol>';
    h += '<p class="prose">Then the two agents move up. Your agent fetches the sender\'s description, checks it, and replies under the strongest set of rules both support. Two agents that began by email can be exchanging fully structured messages by the second one, and neither will accept a step back down in the same conversation.</p>';
    var mailTrace = (AX.traces || []).filter(function (t) { return t.scenario && t.scenario.id === 'no-agent-on-the-other-side'; })[0];
    var swapTrace = (AX.traces || []).filter(function (t) { return t.scenario && t.scenario.id === 'mortgage-main' && t.configuration && t.configuration.id === 'transport-email'; })[0];
    var links = [];
    if (mailTrace) links.push('<a class="btn" href="' + AX.buildHash('explore', { scenario: mailTrace.scenario.id, config: mailTrace.configuration.id }) + '">Step through an agent writing to a business that has only email</a>');
    if (swapTrace) links.push('<a class="btn" href="' + AX.buildHash('explore', { scenario: swapTrace.scenario.id, config: swapTrace.configuration.id }) + '">Step through two agents talking over email</a>');
    if (links.length) h += '<p class="start-links">' + links.join('') + '</p>';

    h += '<h2>Three ways to get an agent</h2>';
    h += '<p class="lede">None of them needs an account with the sender\'s provider. An agent from any of them can talk to an agent from any other.</p>';
    h += '<div class="cards routes">' + ROUTES.map(function (r) {
      return '<div class="card"><p class="route-status"><span class="status ' + r.status + '">' + esc(r.statusLabel) + '</span></p><h3>' + esc(r.name) + '</h3><p>' + esc(r.what) + '</p><p class="small muted">You need: ' + esc(r.need) + '</p></div>';
    }).join('') + '</div>';

    h += '<h2>If you build agents</h2><div class="cards">';
    h += '<div class="card"><h3>Starting from email</h3><p>The entry configuration, the footer rules and how two parties move up.</p><p><a href="' + AX.buildHash('specs', { doc: '20-baseline' }) + '">Read the baseline</a></p></div>';
    h += '<div class="card"><h3>The message and the checks</h3><p>What a verifiable message carries and what each gate decides.</p><p><a href="' + AX.buildHash('specs', { doc: '01-core' }) + '">Read the core specification</a></p></div>';
    h += '<div class="card"><h3>Claiming the name</h3><p>What an agent must show before it may call itself Answerable.</p><p><a href="' + AX.buildHash('specs', { doc: '40-conformance' }) + '">Read conformance</a></p></div>';
    h += '</div>';
    h += '</div>';
    root.innerHTML = h;
  };
})();
