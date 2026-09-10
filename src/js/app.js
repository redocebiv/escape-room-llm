/**
 * Wiring: the chat app on the left, the security console on the right.
 *
 * Every decision the assistant makes lives in engine/, and every number that
 * gets saved lives in progress.js. This file only renders and listens.
 */

import { createSession, respond } from './engine/bot.js';
import { LEVELS, buildLevel, checkUnlock, secretsFor } from './engine/levels.js';
import {
  escapedCount, freshProgress, isUnlocked, loadProgress, recordEscape, recordHint,
  recordMessage, saveProgress,
} from './progress.js';

const $ = (id) => document.getElementById(id);
const TYPING_MS = 320;

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

let progress = loadProgress(storage);
let secrets = secretsFor(progress.seed);
/** In-memory state per room: the built level, its conversation and memory. */
let rooms = new Map();

const save = () => saveProgress(storage, progress);
const levelDef = (id) => LEVELS.find((l) => l.id === id);

function roomState(id) {
  if (!rooms.has(id)) {
    const level = buildLevel(id, secrets[id]);
    rooms.set(id, { level, session: createSession(), log: [welcome(level)] });
  }
  return rooms.get(id);
}

function welcome(level) {
  return [
    { from: 'system', text: `Room ${level.id} — ${level.name}. Get the password, then type it into the unlock box.` },
    { from: 'bot', text: `Hi! I’m ${level.persona.name}, ${level.persona.role}. How can I help?` },
  ];
}

// --- rendering -----------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

/** Show [REDACTED] as a redaction bar rather than as literal brackets. */
function withRedactions(text) {
  const frag = document.createDocumentFragment();
  text.split(/(\[REDACTED\])/).forEach((part) => {
    frag.append(part === '[REDACTED]' ? el('mark', { class: 'redacted' }, 'REDACTED') : part);
  });
  return frag;
}

function messageNode(entry) {
  if (entry.from === 'system') return el('li', { class: 'msg system' }, entry.text);
  const classes = ['msg', entry.from];
  if (entry.blocked) classes.push('blocked');
  const li = el('li', { class: classes.join(' '), dataset: { from: entry.from, leaked: String(Boolean(entry.leaked)), blocked: String(Boolean(entry.blocked)) } });
  if (entry.blocked) li.append(el('span', { class: 'tag' }, 'Content filter'));
  li.append(el('div', { class: 'bubble' }, entry.from === 'bot' ? withRedactions(entry.text) : entry.text));
  return li;
}

function renderNav() {
  const nav = $('rooms');
  nav.replaceChildren(...LEVELS.map((l) => {
    const r = progress.rooms[l.id];
    const locked = !isUnlocked(progress, l.id);
    const classes = ['room-tab', r.escaped && 'is-escaped', locked && 'is-locked'].filter(Boolean).join(' ');
    const state = r.escaped ? 'escaped' : locked ? 'locked' : '';
    return el('button', {
      type: 'button', class: classes, 'aria-current': String(progress.current === l.id),
      dataset: { room: l.id }, 'aria-label': `Room ${l.id}: ${l.name}${state ? ` (${state})` : ''}`,
    }, el('span', { class: 'num' }, r.escaped ? '✓' : String(l.id)), l.name);
  }));
}

function renderMessages() {
  const { log } = roomState(progress.current);
  const list = $('messages');
  list.replaceChildren(...log.flat().map(messageNode));
  list.scrollTop = list.scrollHeight;
}

function appendMessage(entry) {
  const list = $('messages');
  list.append(messageNode(entry));
  list.scrollTop = list.scrollHeight;
}

function systemPromptNode(level, revealed) {
  const frag = document.createDocumentFragment();
  const [before, after] = level.systemPrompt.split(level.secret);
  frag.append(before);
  frag.append(revealed
    ? el('span', { class: 'revealed' }, level.secret)
    : el('span', { class: 'masked', title: 'hidden until you escape' }, '████████'));
  frag.append(after ?? '');
  return frag;
}

function renderConsole() {
  const id = progress.current;
  const def = levelDef(id);
  const { level } = roomState(id);
  const r = progress.rooms[id];

  $('room-no').textContent = String(id);
  $('technique').textContent = def.technique;
  $('level-name').textContent = `${def.id} · ${def.name}`;
  $('owasp').textContent = def.owasp;
  $('brief').textContent = def.brief;
  $('system-prompt').replaceChildren(systemPromptNode(level, r.escaped));
  $('defences').replaceChildren(...def.defences.map((d) => el('li', {}, d)));

  $('unlock-panel').hidden = r.escaped;
  $('escaped').hidden = !r.escaped;
  $('lesson').textContent = def.lesson;
  const next = LEVELS.find((l) => l.id === id + 1);
  $('next').hidden = !next;
  if (next) $('next').textContent = `Room ${next.id}: ${next.name} →`;

  $('hints').replaceChildren(...def.hints.slice(0, r.hints).map((h) => el('li', {}, h)));
  $('hint').hidden = r.hints >= def.hints.length;
  $('hint').textContent = r.hints ? 'Another hint' : 'Show a hint';

  renderStats();
}

function renderStats() {
  $('msg-count').textContent = String(progress.rooms[progress.current].messages);
  $('escaped-count').textContent = String(escapedCount(progress));
}

function renderChatHead() {
  const { level } = roomState(progress.current);
  $('persona-name').textContent = level.persona.name;
  $('persona-role').textContent = level.persona.role;
  $('avatar').textContent = level.persona.name[0];
  $('input').placeholder = `Message ${level.persona.name}…`;
}

function renderLock() {
  const id = progress.current;
  const locked = !isUnlocked(progress, id);
  $('locked').hidden = !locked;
  $('composer').hidden = locked;
  if (locked) $('locked-text').textContent = `Room ${id} opens when you escape room ${id - 1}.`;
}

function render() {
  renderNav();
  renderChatHead();
  renderMessages();
  renderConsole();
  renderLock();
  $('intro').hidden = progress.introSeen;
  $('unlock-feedback').textContent = '';
  $('unlock-feedback').className = 'feedback';
}

// --- actions ------------------------------------------------------------------

function goTo(id) {
  progress.current = id;
  save();
  render();
}

let busy = false;

async function send(text) {
  const id = progress.current;
  const room = roomState(id);
  const userEntry = { from: 'user', text };
  room.log.push(userEntry);
  appendMessage(userEntry);
  recordMessage(progress, id);
  save();
  renderStats();

  busy = true;
  $('send').disabled = true;
  const typing = el('li', { class: 'msg bot typing', 'aria-label': 'typing' }, el('div', { class: 'bubble' }, el('i'), el('i'), el('i')));
  if (progress.current === id) $('messages').append(typing);
  await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
  typing.remove();

  const out = respond(room.level, text, room.session);
  const botEntry = { from: 'bot', text: out.reply, blocked: out.blocked, leaked: out.leaked, trace: out.trace };
  room.log.push(botEntry);
  if (progress.current === id) appendMessage(botEntry);
  busy = false;
  $('send').disabled = false;
}

function tryUnlock(guess) {
  const id = progress.current;
  const { level } = roomState(id);
  const feedback = $('unlock-feedback');
  if (!guess.trim()) return;
  if (checkUnlock(level, guess)) {
    recordEscape(progress, id);
    save();
    renderNav();
    renderConsole();
    const note = { from: 'system', text: `Escaped room ${id} in ${progress.rooms[id].messages} message${progress.rooms[id].messages === 1 ? '' : 's'}.` };
    roomState(id).log.push(note);
    appendMessage(note);
    $('guess').value = '';
    return;
  }
  feedback.textContent = `✗ “${guess.trim()}” isn’t it. Keep talking.`;
  feedback.className = 'feedback wrong';
  const form = $('unlock');
  form.classList.remove('shake');
  void form.offsetWidth;
  form.classList.add('shake');
}

let resetArmed = false;

function resetProgress() {
  if (!resetArmed) {
    resetArmed = true;
    $('reset').textContent = 'Click again to wipe all progress';
    setTimeout(() => {
      resetArmed = false;
      $('reset').textContent = 'Reset progress';
    }, 4000);
    return;
  }
  resetArmed = false;
  $('reset').textContent = 'Reset progress';
  progress = freshProgress();
  progress.introSeen = true;
  secrets = secretsFor(progress.seed);
  rooms = new Map();
  save();
  render();
}

// --- events -------------------------------------------------------------------

$('rooms').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-room]');
  if (tab) goTo(Number(tab.dataset.room));
});

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('input');
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  input.style.height = '';
  send(text);
});

$('input').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});

$('input').addEventListener('input', (e) => {
  const t = e.target;
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
});

$('unlock').addEventListener('submit', (e) => {
  e.preventDefault();
  tryUnlock($('guess').value);
});

$('hint').addEventListener('click', () => {
  recordHint(progress, progress.current, levelDef(progress.current).hints.length);
  save();
  renderConsole();
});

$('next').addEventListener('click', () => goTo(progress.current + 1));

$('open-anyway').addEventListener('click', () => {
  progress.rooms[progress.current].opened = true;
  save();
  render();
});

$('start').addEventListener('click', () => {
  progress.introSeen = true;
  save();
  $('intro').hidden = true;
  $('input').focus();
});

$('about').addEventListener('click', () => {
  $('intro').hidden = false;
  $('intro').scrollIntoView({ behavior: 'smooth' });
});

$('reset').addEventListener('click', resetProgress);

render();
