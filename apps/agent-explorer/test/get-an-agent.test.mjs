// AUTHORED-BY Codex GPT-6.2 Sol
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import page from '../js/get-an-agent.js';

test('the setup page explains both routes and the fictional research preview', () => {
  const html = page.html();
  assert.match(html, /<h2>Route 1\. Connect the assistant you already use\.<\/h2>/);
  assert.match(html, /<h2>Route 2\. Use a hosted agent\.<\/h2>/);
  assert.match(html, /<strong>Research preview\.<\/strong>.*fictional/);
  assert.match(html, /The Errand demo is hosted with the public copy of this site\./);
  assert.doesNotMatch(html, /Step through a run over (MCP|A2A)|Open the Errand demo/);
  assert.match(page.html({ mcp: true }), /Step through a run over MCP/);
  assert.doesNotMatch(page.html({ mcp: true }), /Step through a run over A2A/);
  assert.match(page.html({ a2a: true }), /Step through a run over A2A/);
  assert.doesNotMatch(page.html({ a2a: true }), /Step through a run over MCP/);
});

test('the setup page contains only local links and no signup controls', () => {
  const html = page.html({ mcp: true, a2a: true, errand: true });
  assert.doesNotMatch(html, /<form|<input|<textarea|mailto:|\b(?:sign up now|join|waitlist|available now)\b/i);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.length > 0);
  assert.ok(links.every((href) => href.startsWith('#/') || href === 'app/'));
  assert.match(html, /href="app\/">Open the Errand demo/);
});

test('navigation points to setup and the footer explanation links to it', () => {
  const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
  assert.match(read('../index.html'), /js\/get-an-agent\.js[^]*js\/home\.js/);
  assert.match(read('../js/app.js'), /id: 'get-an-agent', label: 'Get an agent'/);
  assert.match(read('../js/home.js'), /view: 'get-an-agent'/);
  const start = read('../js/start.js');
  assert.match(start, /href="#\/get-an-agent">See how to get an agent/);
  assert.match(start, /FOOTER_LINK = 'https:\/\/answerableagents\.org\/#\/start'/);
});
