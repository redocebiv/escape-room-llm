import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, escapedCount, freshProgress, isUnlocked, loadProgress, messagesUsed,
  recordEscape, recordHint, recordMessage, saveProgress,
} from '../../src/js/progress.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

test('a fresh start has a seed and only room 1 open', () => {
  const p = freshProgress();
  assert.match(p.seed, /^[0-9a-f]{16}$/);
  assert.equal(isUnlocked(p, 1), true);
  assert.equal(isUnlocked(p, 2), false);
  assert.equal(isUnlocked(p, 5), false);
});

test('progress survives a save and load', () => {
  const storage = memoryStorage();
  const p = freshProgress('abc');
  recordMessage(p, 1);
  recordMessage(p, 1);
  recordEscape(p, 1);
  p.current = 2;
  saveProgress(storage, p);
  const back = loadProgress(storage);
  assert.equal(back.seed, 'abc');
  assert.equal(back.current, 2);
  assert.equal(back.rooms[1].messages, 2);
  assert.equal(back.rooms[1].escaped, true);
  assert.equal(isUnlocked(back, 2), true);
});

test('messages after escaping do not count', () => {
  const p = freshProgress('s');
  recordMessage(p, 1);
  recordEscape(p, 1);
  recordMessage(p, 1);
  assert.equal(p.rooms[1].messages, 1);
});

test('the score counts escaped rooms only', () => {
  const p = freshProgress('s');
  recordMessage(p, 1);
  recordEscape(p, 1);
  for (let i = 0; i < 5; i += 1) recordMessage(p, 2);
  assert.equal(escapedCount(p), 1);
  assert.equal(messagesUsed(p), 1);
});

test('hints never exceed what the room offers', () => {
  const p = freshProgress('s');
  for (let i = 0; i < 9; i += 1) recordHint(p, 1, 3);
  assert.equal(p.rooms[1].hints, 3);
});

test('a room can be opened early without counting as escaped', () => {
  const p = freshProgress('s');
  p.rooms[3].opened = true;
  assert.equal(isUnlocked(p, 3), true);
  assert.equal(escapedCount(p), 0);
});

test('corrupt or foreign saved data falls back to a fresh start', () => {
  for (const raw of ['{not json', 'null', '{"version":2,"seed":"x"}', '{"version":1}', '[]']) {
    const p = loadProgress(memoryStorage({ [STORAGE_KEY]: raw }));
    assert.equal(p.version, 1, raw);
    assert.equal(escapedCount(p), 0, raw);
  }
});

test('bad field values are sanitised', () => {
  const raw = JSON.stringify({ version: 1, seed: 'q', current: 99, rooms: { 1: { messages: -4, escaped: 'yes' } }, defence: { best: 'high' } });
  const p = loadProgress(memoryStorage({ [STORAGE_KEY]: raw }));
  assert.equal(p.current, 1);
  assert.equal(p.rooms[1].messages, 0);
  assert.equal(p.rooms[1].escaped, false);
  assert.equal(p.defence.best, null);
});

test('no storage at all still works', () => {
  assert.equal(loadProgress(null).version, 1);
  assert.equal(saveProgress(null, freshProgress()), false);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadProgress(throwing).version, 1);
  assert.equal(saveProgress(throwing, freshProgress()), false);
});
