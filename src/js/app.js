/**
 * Wiring: the chat app on the left, the security console on the right.
 *
 * Every decision the assistant makes lives in engine/, and every number that
 * gets saved lives in progress.js. This file only renders and listens.
 */

import attacksData from '../data/attacks.json';
import benignData from '../data/benign.json';
import { DEFEND, promptFor, readForm, renderResult, writeForm } from './defend.js';
import { el } from './dom.js';
import { createSession, respond } from './engine/bot.js';
import { DEFAULT_DEFENCE, buildDefendedLevel, runBattery } from './engine/defence.js';
import { LEVELS, buildLevel, checkUnlock, secretsFor } from './engine/levels.js';
import { traceList, traceToggle } from './inspector.js';
import {
  escapedCount, freshProgress, isUnlocked, loadProgress, recordEscape, recordHint,
  recordMessage, saveProgress,
} from './progress.js';
import { shareLine } from './share.js';

const $ = (id) => document.getElementById(id);
const TYPING_MS = 320;
const CORPUS = { attacks: attacksData.attacks, benign: benignData.requests };
const ROOM_DEFS = [...LEVELS, DEFEND];
const DEFEND_ID = DEFEND.id;

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
let lastResult = null;

const save = () => saveProgress(storage, progress);
const roomDef = (id) => ROOM_DEFS.find((l) => l.id === id);
const defenceOptions = () => ({ ...DEFAULT_DEFENCE, ...(progress.defence.options ?? {}) });
/** The trace is a reward for escaping — except in the defence room, where you're the one in charge. */
const inspectorOpen = (id) => id === DEFEND_ID || progress.rooms[id].escaped;

function buildRoomLevel(id) {
  return id === DEFEND_ID ? buildDefendedLevel(defenceOptions(), secrets[id]) : buildLevel(id, secrets[id]);
}

function roomState(id) {
  if (!rooms.has(id)) {
    const level = buildRoomLevel(id);
    rooms.set(id, { id, level, session: createSession(), log: welcome(id, level) });
  }
  return rooms.get(id);
}

function welcome(id, level) {
  const intro = id === DEFEND_ID
    ? 'Room 5 — Defend. Build Nova’s guards in the console, then run the red-team battery. You can attack Nova here yourself, too.'
    : `Room ${id} — ${level.name}. Get the password, then type it into the unlock box.`;
  return [
    { from: 'system', text: intro },
    { from: 'bot', text: `Hi! I’m ${level.persona.name}, ${level.persona.role}. How can I help?` },
  ];
}

// --- rendering -----------------------------------------------------------------

/** Show [REDACTED] as a redaction bar rather than as literal brackets. */
function withRedactions(text) {
  const frag = document.createDocumentFragment();
  text.split(/(\[REDACTED\])/).forEach((part) => {
    frag.append(part === '[REDACTED]' ? el('mark', { class: 'redacted' }, 'REDACTED') : part);
  });
  return frag;
}

function messageNode(entry, roomId) {
  if (entry.from === 'system') return el('li', { class: 'msg system' }, entry.text);
  const classes = ['msg', entry.from, entry.blocked && 'blocked'].filter(Boolean).join(' ');
  return el('li', { class: classes, dataset: { from: entry.from, leaked: String(Boolean(entry.leaked)), blocked: String(Boolean(entry.blocked)) } },
    entry.blocked ? el('span', { class: 'tag' }, 'Content filter') : null,
    el('div', { class: 'bubble' }, entry.from === 'bot' ? withRedactions(entry.text) : entry.text),
    entry.trace && inspectorOpen(roomId) ? traceToggle(entry.trace) : null);
}

function renderNav() {
  $('rooms').replaceChildren(...ROOM_DEFS.map((l) => {
    const r = progress.rooms[l.id];
    const locked = !isUnlocked(progress, l.id);
    const classes = ['room-tab', r.escaped && 'is-escaped', locked && 'is-locked'].filter(Boolean).join(' ');
    const state = r.escaped ? (l.id === DEFEND_ID ? 'defended' : 'escaped') : locked ? 'locked' : '';
    return el('button', {
      type: 'button', class: classes, 'aria-current': String(progress.current === l.id),
      dataset: { room: l.id }, 'aria-label': `Room ${l.id}: ${l.name}${state ? ` (${state})` : ''}`,
    }, el('span', { class: 'num' }, r.escaped ? '✓' : String(l.id)), l.name);
  }));
}

function renderMessages() {
  const room = roomState(progress.current);
  const list = $('messages');
  list.replaceChildren(...room.log.map((entry) => messageNode(entry, room.id)));
  list.scrollTop = list.scrollHeight;
}

function appendMessage(entry, roomId) {
  const list = $('messages');
  list.append(messageNode(entry, roomId));
  list.scrollTop = list.scrollHeight;
}

function systemPromptNode(text, secret, revealed) {
  const frag = document.createDocumentFragment();
  const [before, after] = text.split(secret);
  frag.append(before);
  frag.append(revealed
    ? el('span', { class: 'revealed' }, secret)
    : el('span', { class: 'masked', title: 'hidden until you escape' }, '████████'));
  frag.append(after ?? '');
  return frag;
}

function renderInspector(id) {
  const open = inspectorOpen(id);
  $('inspector-locked').hidden = open;
  if (!open) {
    $('inspector').replaceChildren();
    return;
  }
  const bots = roomState(id).log.filter((e) => e.trace);
  const shown = bots.findLast((e) => e.leaked) ?? bots.at(-1);
  $('inspector').replaceChildren(shown
    ? el('div', {}, el('p', { class: 'inspector-for' }, `“${shown.text.length > 80 ? `${shown.text.slice(0, 79)}…` : shown.text}”`), traceList(shown.trace))
    : el('p', { class: 'muted' }, 'Send a message to see its trace.'));
}

function renderAttackConsole(id) {
  const def = roomDef(id);
  const { level } = roomState(id);
  const r = progress.rooms[id];

  $('technique').textContent = def.technique;
  $('level-name').textContent = `${def.id} · ${def.name}`;
  $('owasp').textContent = def.owasp;
  $('brief').textContent = def.brief;
  $('system-prompt').replaceChildren(systemPromptNode(level.systemPrompt, level.secret, r.escaped));
  $('defences').replaceChildren(...def.defences.map((d) => el('li', {}, d)));

  $('unlock-panel').hidden = r.escaped;
  $('escaped').hidden = !r.escaped;
  $('lesson').textContent = def.lesson;
  const next = roomDef(id + 1);
  $('next').textContent = `Room ${next.id}: ${next.name} →`;
  renderInspector(id);
}

function renderDefendConsole() {
  const options = defenceOptions();
  $('d-brief').textContent = DEFEND.brief;
  $('d-prompt').textContent = promptFor(options, secrets[DEFEND_ID]);
  $('battery-size').textContent = `${CORPUS.attacks.length} attacks and ${CORPUS.benign.length} ordinary requests, each in a fresh conversation.`;
  $('battery-result').hidden = !lastResult;
  $('d-escaped').hidden = !progress.rooms[DEFEND_ID].escaped;
  $('d-lesson').textContent = DEFEND.lesson;
}

function renderConsole() {
  const id = progress.current;
  const def = roomDef(id);
  const r = progress.rooms[id];
  $('room-no').textContent = String(id);
  $('attack-console').hidden = id === DEFEND_ID;
  $('defend-console').hidden = id !== DEFEND_ID;
  if (id === DEFEND_ID) renderDefendConsole();
  else renderAttackConsole(id);

  $('hints').replaceChildren(...def.hints.slice(0, r.hints).map((h) => el('li', {}, h)));
  $('hint').hidden = r.hints >= def.hints.length;
  $('hint').textContent = r.hints ? 'Another hint' : 'Show a hint';

  renderStats();
  renderShare();
}

function renderStats() {
  $('msg-count').textContent = String(progress.rooms[progress.current].messages);
  $('escaped-count').textContent = String(escapedCount(progress));
}

const siteUrl = () => `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;

function renderShare() {
  const show = escapedCount(progress) > 0 || progress.defence.best != null;
  $('share-panel').hidden = !show;
  if (show) $('share-text').value = shareLine(progress, siteUrl());
}

function renderChatHead() {
  const { level } = roomState(progress.current);
  $('persona-name').textContent = level.persona.name;
  $('persona-role').textContent = level.persona.role;
  $('avatar').textContent = level.persona.name[0];
  $('avatar').classList.toggle('nova', progress.current === DEFEND_ID);
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
  appendMessage(userEntry, id);
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
  if (progress.current === id) {
    appendMessage(botEntry, id);
    if (id !== DEFEND_ID) renderInspector(id);
  }
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
    const used = progress.rooms[id].messages;
    roomState(id).log.push({ from: 'system', text: `Escaped room ${id} in ${used} message${used === 1 ? '' : 's'}. The inspector is open — expand any reply to see why it said that.` });
    $('guess').value = '';
    renderNav();
    renderMessages();
    renderConsole();
    return;
  }
  feedback.textContent = `✗ “${guess.trim()}” isn’t it. Keep talking.`;
  feedback.className = 'feedback wrong';
  const form = $('unlock');
  form.classList.remove('shake');
  void form.offsetWidth;
  form.classList.add('shake');
}

/** New guards take effect in the chat at once, in a fresh conversation memory. */
function applyDefence() {
  progress.defence.options = readForm();
  save();
  const room = roomState(DEFEND_ID);
  room.level = buildRoomLevel(DEFEND_ID);
  room.session = createSession();
  $('d-prompt').textContent = promptFor(defenceOptions(), secrets[DEFEND_ID]);
}

function runTheBattery() {
  applyDefence();
  const result = runBattery(defenceOptions(), CORPUS, secrets[DEFEND_ID]);
  lastResult = result;
  const d = progress.defence;
  d.best = Math.max(d.best ?? 0, result.score);
  if (result.passed) {
    d.passed = true;
    recordEscape(progress, DEFEND_ID);
  }
  save();
  renderResult($('battery-result'), result, { onTry: tryInChat });
  renderNav();
  renderConsole();
}

function tryInChat(text) {
  const input = $('input');
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.focus();
  $('messages').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function copyShare() {
  const field = $('share-text');
  let ok = false;
  try {
    await navigator.clipboard.writeText(field.value);
    ok = true;
  } catch {
    field.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
  }
  $('share-status').textContent = ok ? 'Copied.' : 'Select the line and copy it.';
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
  lastResult = null;
  writeForm(DEFAULT_DEFENCE);
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
  recordHint(progress, progress.current, roomDef(progress.current).hints.length);
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

$('defence-form').addEventListener('change', applyDefence);
$('defence-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runTheBattery();
});

$('copy-share').addEventListener('click', copyShare);
$('reset').addEventListener('click', resetProgress);

writeForm(defenceOptions());
render();
