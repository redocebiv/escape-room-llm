/**
 * Views of a message — the gap between what a filter sees and what a model
 * understands.
 *
 * A string filter compares characters. A language model reads meaning: it reads
 * leetspeak, look-alike letters, invisible characters, Base64 and spaced-out
 * words as easily as plain text. The engine models that asymmetry on purpose.
 * The bot's understanding uses every view below; a guard uses only the views its
 * defender switched on. That gap is the whole lesson of the filter levels.
 *
 * Pure: no DOM.
 */

export const ZERO_WIDTH = /[​‌‍⁠﻿]/g;

/** Cyrillic and Greek letters that render identically to Latin ones. */
const CONFUSABLES = new Map(Object.entries({
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ӏ: 'l',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'I', Ѕ: 'S',
  ο: 'o', α: 'a', ν: 'v', ρ: 'p', Ο: 'O', Α: 'A', Ρ: 'P',
}));

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '€': 'e' };

export const stripZeroWidth = (s) => s.replace(ZERO_WIDTH, '');

export function foldConfusables(s) {
  let out = '';
  for (const ch of s) out += CONFUSABLES.get(ch) ?? ch;
  return out;
}

export const hasConfusables = (s) => [...s].some((ch) => CONFUSABLES.has(ch));

export const foldLeet = (s) => s.replace(/[0134578@$!|€]/g, (ch) => LEET[ch]);

/** Join runs of single letters separated by spaces or dashes: "p a s s" → "pass". */
export const unspace = (s) => s.replace(/(?<!\p{L})(?:\p{L}[ \-._]){2,}\p{L}(?!\p{L})/gu, (m) => m.replace(/[ \-._]/g, ''));

/**
 * Decode Base64-looking tokens. Only tokens that decode to mostly readable
 * text count, so a long ordinary word is not mistaken for Base64.
 */
export function decodeBase64Tokens(s) {
  const decoded = [];
  for (const match of s.matchAll(/[A-Za-z0-9+/]{12,}={0,2}/g)) {
    const token = match[0];
    if (token.length % 4 === 1) continue;
    try {
      const bytes = Uint8Array.from(atob(token), (c) => c.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const letters = (text.match(/\p{L}/gu) ?? []).length;
      const printable = [...text].every((c) => c === '\n' || c === '\t' || c >= ' ');
      if (printable && text.includes(' ') && letters / text.length > 0.5) decoded.push(text);
    } catch {
      // Not Base64, or not text. Ignore.
    }
  }
  return decoded;
}

/** Every reading of a message that a language model would effortlessly make. */
export function modelViews(text) {
  const base = stripZeroWidth(text.normalize('NFKC'));
  const lower = base.toLowerCase();
  const folded = foldConfusables(base).toLowerCase();
  const views = new Set([lower, folded, foldLeet(folded), unspace(folded)]);
  for (const decoded of decodeBase64Tokens(base)) views.add(foldConfusables(decoded).toLowerCase());
  return [...views];
}

/** What a guard sees, given the defender's options. */
export function guardViews(text, { normalizeUnicode = false, decodeObfuscation = false } = {}) {
  let t = text;
  if (normalizeUnicode) t = foldConfusables(stripZeroWidth(t.normalize('NFKC')));
  const lower = t.toLowerCase();
  const views = new Set([lower]);
  if (decodeObfuscation) {
    views.add(foldLeet(lower));
    views.add(unspace(lower));
    for (const decoded of decodeBase64Tokens(t)) views.add(decoded.toLowerCase());
  }
  return [...views];
}

/** Which obfuscations a message uses — for the trace, never for decisions. */
export function obfuscationsIn(text) {
  const found = [];
  if (ZERO_WIDTH.test(text)) found.push('zero-width characters');
  ZERO_WIDTH.lastIndex = 0;
  if (hasConfusables(text) && /[a-z]/i.test(text)) found.push('look-alike letters');
  if (decodeBase64Tokens(text).length) found.push('Base64');
  const folded = foldConfusables(stripZeroWidth(text)).toLowerCase();
  if (foldLeet(folded) !== folded && /\p{L}[0134578@$]\p{L}/u.test(folded)) found.push('leetspeak');
  if (unspace(folded) !== folded) found.push('spaced-out letters');
  return found;
}
