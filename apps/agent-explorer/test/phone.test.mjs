// AUTHORED-BY Claude Opus 5.5
// Sam's phone is drawn only from the trace: these tests pin what each moment of the recorded
// mortgage runs puts on the principal's screen, and that every fact on an approval sheet is
// text the agent actually sent.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import phone from '../js/phone.js';

function trace(key) {
  return JSON.parse(readFileSync(new URL(`../data/traces/${key}.json`, import.meta.url), 'utf8'));
}
const opt = { principal: 'Sam, the fictional applicant', agentName: 'Sam’s agent' };
const base = trace('mortgage-main--baseline');
const human = trace('mortgage-main--usage-control-human-approval');

function indexOf(t, pred, from = 0) {
  for (let i = from; i < t.events.length; i++) if (pred(t.events[i])) return i;
  return -1;
}

test('the mandate screen lists the signed rules, split by whether the agent asks first', () => {
  const m = phone.model(base, 0, opt);
  assert.equal(m.autoTab, 'mandate');
  assert.equal(m.principal, 'Sam');
  assert.equal(m.mandate.rules.length, 9);
  assert.equal(m.mandate.until, '2027-01-12');
  assert.ok(m.mandate.rules.filter((r) => r.own === false).length >= 1);
  assert.deepEqual(m.limits, [
    { label: 'Each payment', value: '600 USD' },
    { label: 'Per calendar month', value: '600 USD' },
  ]);
});

test('each ask opens a sheet until its answer, then the answer is confirmed on the device', () => {
  for (const pair of phone.asks(base)) {
    const sheet = phone.model(base, pair.ask, opt).overlay;
    assert.equal(sheet.type, 'sheet');
    const text = base.events[pair.ask].chat.text;
    for (const [, value] of sheet.ask.facts) {
      if (value !== 'A certified face check') assert.ok(text.includes(value), `${value} is in the agent's words`);
    }
    const confirm = phone.model(base, pair.reply, opt).overlay;
    assert.equal(confirm.type, 'confirm');
    assert.equal(confirm.declined, false);
    assert.equal(phone.model(base, pair.reply + 1, opt).overlay, null);
  }
});

test('the face check is shown while the identity provider statement is checked', () => {
  const ask = indexOf(base, (e) => e.kind === 'ask-principal' && /face check/.test(e.chat.text));
  const admitted = indexOf(base, (e) => e.kind === 'decision' && /identity approval statement/.test(e.caption), ask);
  const during = phone.model(base, ask + 1, opt).overlay;
  assert.equal(during.type, 'face');
  assert.equal(during.done, false);
  assert.equal(during.by, 'The fictional identity provider');
  assert.equal(phone.model(base, admitted, opt).overlay.done, true);
});

test('payment asks carry a limit meter computed from the quoted amounts', () => {
  const ask = indexOf(base, (e) => e.kind === 'ask-principal' && /^May I pay/.test(e.chat.text));
  const o = phone.model(base, ask, opt).overlay;
  assert.equal(o.ask.title, 'Pay 450.00 USD');
  assert.deepEqual(o.meter, { amount: '450.00 USD', limit: '600 USD', frac: 0.75 });
});

test('the human-approval run adds an ask with its message digest', () => {
  const asks = phone.asks(human);
  assert.equal(asks.length, phone.asks(base).length + 1);
  const o = phone.model(human, asks.at(-1).ask, opt).overlay;
  assert.equal(o.ask.kind, 'send');
  assert.match(o.digest, /^sha-256:[0-9a-f]{64}$/);
});

test('a declined answer is shown as declined', () => {
  const t = trace('mortgage-out-of-limit--baseline');
  const pair = phone.asks(t).find((p) => p.reply != null && phone.declined(t.events[p.reply]));
  assert.ok(pair);
  const m = phone.model(t, pair.reply, opt);
  assert.equal(m.overlay.declined, true);
  assert.equal(m.feed.find((f) => f.type === 'ask-chip' && f.i === pair.ask).state, 'declined');
});
