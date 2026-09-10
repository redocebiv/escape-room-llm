import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshProgress, recordEscape, recordMessage } from '../../src/js/progress.js';
import { shareLine } from '../../src/js/share.js';

const URL = 'https://example.test/escape-room-llm/';

test('nothing escaped yet', () => {
  assert.equal(shareLine(freshProgress('s'), URL), `I escaped 0/4 rooms of the Prompt Injection Escape Room. ${URL}`);
});

test('rooms and messages are counted, with plurals', () => {
  const p = freshProgress('s');
  recordMessage(p, 1);
  recordEscape(p, 1);
  assert.match(shareLine(p, URL), /escaped 1\/4 rooms .* in 1 message\. /);
  recordMessage(p, 2);
  recordMessage(p, 2);
  recordEscape(p, 2);
  assert.match(shareLine(p, URL), /escaped 2\/4 rooms .* in 3 messages\. /);
});

test('the defence score is included once there is one', () => {
  const p = freshProgress('s');
  p.defence.best = 71;
  assert.match(shareLine(p, URL), /scored 71\/100 \(not passing yet\)/);
  p.defence.best = 100;
  p.defence.passed = true;
  assert.match(shareLine(p, URL), /scored 100\/100\. https/);
});

test('the line never contains a secret', () => {
  const p = freshProgress('s');
  for (const id of [1, 2, 3, 4]) recordEscape(p, id);
  assert.doesNotMatch(shareLine(p, URL), /OBSIDIAN|KESTREL|JUNIPER|BAITEREK|SHANYRAQ|LABYRINTH|MERIDIAN|ZEPHYRUS|TULPAR|QUICKSILVER|ALATAU|SAXAUL/);
});
