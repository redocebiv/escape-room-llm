/**
 * Progress: which rooms are escaped, how many messages each took, and the
 * seed that picks this player's secrets. Saved in localStorage.
 *
 * Pure apart from the storage object passed in, which may be null — private
 * windows and blocked site data must still get a working game.
 */

export const STORAGE_KEY = 'escape-room-llm:v1';
export const ATTACK_ROOMS = [1, 2, 3, 4];
export const ROOMS = [...ATTACK_ROOMS, 5];

export function newSeed() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const freshRoom = () => ({ messages: 0, hints: 0, escaped: false, opened: false });

export function freshProgress(seed = newSeed()) {
  return {
    version: 1,
    seed,
    current: 1,
    introSeen: false,
    rooms: Object.fromEntries(ROOMS.map((id) => [id, freshRoom()])),
    defence: { options: null, best: null, passed: false },
  };
}

const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);

/** Anything unreadable falls back to a fresh start rather than a broken page. */
export function loadProgress(storage) {
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (!saved || saved.version !== 1 || typeof saved.seed !== 'string' || !saved.seed) return freshProgress();

  const p = freshProgress(saved.seed);
  p.current = ROOMS.includes(saved.current) ? saved.current : 1;
  p.introSeen = saved.introSeen === true;
  for (const id of ROOMS) {
    const r = saved.rooms?.[id] ?? {};
    p.rooms[id] = { messages: count(r.messages), hints: count(r.hints), escaped: r.escaped === true, opened: r.opened === true };
  }
  const d = saved.defence ?? {};
  p.defence = {
    options: d.options && typeof d.options === 'object' ? d.options : null,
    best: Number.isFinite(d.best) ? d.best : null,
    passed: d.passed === true,
  };
  return p;
}

export function saveProgress(storage, progress) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(progress));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/** Only messages sent before escaping count towards the score. */
export function recordMessage(progress, id) {
  const room = progress.rooms[id];
  if (!room.escaped) room.messages += 1;
}

export function recordHint(progress, id, available) {
  const room = progress.rooms[id];
  room.hints = Math.min(room.hints + 1, available);
}

export function recordEscape(progress, id) {
  progress.rooms[id].escaped = true;
}

export const isUnlocked = (progress, id) => id === 1 || progress.rooms[id].opened || progress.rooms[id - 1].escaped;

export const escapedCount = (progress) => ATTACK_ROOMS.filter((id) => progress.rooms[id].escaped).length;

export const messagesUsed = (progress) =>
  ATTACK_ROOMS.filter((id) => progress.rooms[id].escaped).reduce((n, id) => n + progress.rooms[id].messages, 0);
