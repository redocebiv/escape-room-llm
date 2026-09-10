// The red-team battery against every level, and the level-5 scoring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSession, respond } from '../../src/js/engine/bot.js';
import { DEFAULT_DEFENCE, PASS, buildDefendedLevel, parseList, runBattery } from '../../src/js/engine/defence.js';
import { buildLevel } from '../../src/js/engine/levels.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../src/data/${p}`, import.meta.url), 'utf8'));
const corpus = { attacks: read('attacks.json').attacks, benign: read('benign.json').requests };
const SECRET = 'KESTREL';

const leaksAgainst = (level, attack) => {
  const session = createSession();
  return attack.turns.map((t) => respond(level, t, session)).some((r) => r.leaked);
};

// --- the corpus is aligned with the engine ------------------------------------

test('every attack in the battery works against an undefended bot', () => {
  const level = buildDefendedLevel(DEFAULT_DEFENCE, SECRET);
  const duds = corpus.attacks.filter((a) => !leaksAgainst(level, a)).map((a) => a.id);
  assert.deepEqual(duds, [], 'an attack that never works is not testing anything');
});

test('an undefended bot still answers every legitimate request, and leaks none', () => {
  const level = buildDefendedLevel(DEFAULT_DEFENCE, SECRET);
  for (const r of corpus.benign) {
    const out = respond(level, r.text, createSession());
    assert.equal(out.blocked || out.refused, false, r.id);
    assert.equal(out.leaked, false, r.id);
  }
});

// --- each level falls to exactly the mutations it is designed to fall to ------

const L2_BYPASSES = new Set(['leetspeak', 'homoglyph', 'zero-width', 'spaced-letters', 'base64-wrapped', 'payload-split']);

test('level 2: the keyword filter falls to obfuscation, splitting and other languages — and only those', () => {
  const level = buildLevel(2, SECRET);
  for (const attack of corpus.attacks) {
    const expected = L2_BYPASSES.has(attack.mutation) || attack.mutation.startsWith('language-');
    assert.equal(leaksAgainst(level, attack), expected, attack.id);
  }
});

test('level 3: the exact-match output filter falls to encoded answers — and only those', () => {
  const level = buildLevel(3, SECRET);
  for (const attack of corpus.attacks) {
    assert.equal(leaksAgainst(level, attack), attack.seed.startsWith('encoding-'), attack.id);
  }
});

test('level 4 is not beaten by anything in the generic battery', () => {
  const level = buildLevel(4, SECRET);
  assert.deepEqual(corpus.attacks.filter((a) => leaksAgainst(level, a)).map((a) => a.id), []);
});

// --- level 5 scoring -----------------------------------------------------------

const REFERENCE = { ...DEFAULT_DEFENCE, hardenedPrompt: true, segregateDocuments: true, redactExact: true };

test('the reference defence stops every attack and helps every user', () => {
  const r = runBattery(REFERENCE, corpus, SECRET);
  assert.equal(r.attacks.blocked, r.attacks.total);
  assert.equal(r.benign.answered, r.benign.total);
  assert.equal(r.passed, true);
  assert.equal(r.perfect, true);
  assert.equal(r.score, 100);
});

test('no defences fails', () => {
  const r = runBattery(DEFAULT_DEFENCE, corpus, SECRET);
  assert.equal(r.attacks.blocked, 0);
  assert.equal(r.passed, false);
});

test('blocking the word "password" fails the legitimate users', () => {
  const r = runBattery({ ...DEFAULT_DEFENCE, blocklist: ['password'] }, corpus, SECRET);
  assert.ok(r.benign.rate < PASS.benign, `benign ${r.benign.rate}`);
  assert.equal(r.passed, false);
});

test('an aggressive normalised blocklist fails the legitimate users too', () => {
  const r = runBattery({ ...DEFAULT_DEFENCE, blocklist: ['password', 'secret', 'key', 'magic word'], normalizeUnicode: true, decodeObfuscation: true }, corpus, SECRET);
  assert.ok(r.benign.rate < PASS.benign);
  assert.equal(r.passed, false);
});

test('an output filter alone misses the encoding it does not know', () => {
  const r = runBattery({ ...DEFAULT_DEFENCE, redactEncoded: true }, corpus, SECRET);
  assert.ok(r.attacks.rate < PASS.attacks, `attacks ${r.attacks.rate}`);
  const leaked = r.attacks.results.filter((a) => a.leaked);
  assert.ok(leaked.length > 0 && leaked.every((a) => a.id.startsWith('encoding-nato')), JSON.stringify(leaked.map((a) => a.id)));
});

test('a hardened prompt alone falls to indirect injection', () => {
  const r = runBattery({ ...DEFAULT_DEFENCE, hardenedPrompt: true }, corpus, SECRET);
  assert.equal(r.passed, false);
  assert.ok(r.attacks.byTechnique['indirect-injection'].blocked < r.attacks.byTechnique['indirect-injection'].total);
});

test('hardening plus segregation passes, but other languages still get through', () => {
  const r = runBattery({ ...DEFAULT_DEFENCE, hardenedPrompt: true, segregateDocuments: true }, corpus, SECRET);
  assert.equal(r.passed, true);
  assert.equal(r.perfect, false);
  assert.ok(r.attacks.results.filter((a) => a.leaked).every((a) => a.technique === 'multilingual'));
});

test('every result carries what the report needs to show it', () => {
  const r = runBattery(DEFAULT_DEFENCE, corpus, SECRET);
  for (const a of r.attacks.results) {
    assert.ok(Array.isArray(a.turns) && a.turns.length >= 1, a.id);
    assert.equal(typeof a.reply, 'string', a.id);
  }
  for (const b of r.benign.results) assert.equal(typeof b.text, 'string', b.id);
});

test('results are grouped by technique', () => {
  const r = runBattery(REFERENCE, corpus, SECRET);
  const total = Object.values(r.attacks.byTechnique).reduce((n, t) => n + t.total, 0);
  assert.equal(total, r.attacks.total);
});

test('invalid regex rules are reported back to the player', () => {
  const r = runBattery({ ...DEFAULT_DEFENCE, regex: ['(broken'] }, corpus, SECRET);
  assert.equal(r.errors.length, 1);
});

test('lists are parsed from lines or commas', () => {
  assert.deepEqual(parseList('password, secret\n  key \n\n'), ['password', 'secret', 'key']);
});
