/**
 * The inspector: the assistant's decision trace, one line per pipeline stage.
 * It unlocks once you escape a room, and is always open in the defence room,
 * because a defender gets to see everything.
 */

import { el } from './dom.js';

const MARKS = { pass: '✓', blocked: '■', warn: '!', leak: '✗', info: '·' };

export function traceList(trace) {
  return el('ol', { class: 'trace' }, ...trace.map((s) => el(
    'li', { class: `step ${s.outcome}`, dataset: { stage: s.stage, outcome: s.outcome } },
    el('span', { class: 'mark', 'aria-hidden': 'true' }, MARKS[s.outcome] ?? '·'),
    el('span', { class: 'stage' }, s.stage),
    el('span', { class: 'detail' }, s.detail),
  )));
}

/** A collapsible "why did it say that?" under a reply. */
export function traceToggle(trace, open = false) {
  return el('details', { class: 'why', open },
    el('summary', {}, 'Why did it say that?'),
    traceList(trace));
}
