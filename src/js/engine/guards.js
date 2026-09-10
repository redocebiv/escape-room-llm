/**
 * Guards: the defences a level runs. They are deliberately string-level — a
 * blocklist, a regex, a redaction pass — because that is what most real
 * deployments bolt on, and string-level is exactly what the attacks in this game
 * get around.
 *
 * Pure: no DOM. Every guard reports which rule fired, for the trace.
 */

import { decodeBase64Tokens, foldConfusables, guardViews, stripZeroWidth } from './normalize.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Block a message if any word appears at the start of a word in it. Prefix
 * matching is what naive filters do, so "key" also catches "keyboard" — the
 * kind of false positive level 5 makes you weigh.
 */
export function blocklistGuard(words, options = {}) {
  const patterns = words
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .map((w) => ({ word: w, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(w)}`, 'iu') }));
  return (text) => {
    const views = guardViews(text, options);
    for (const { word, re } of patterns) {
      if (views.some((v) => re.test(v))) return { blocked: true, rule: `blocklist matched "${word}"` };
    }
    return { blocked: false };
  };
}

/** Compile user regexes. Invalid ones are reported rather than silently dropped. */
export function regexGuard(sources, options = {}) {
  const compiled = [];
  const errors = [];
  for (const source of sources.map((s) => s.trim()).filter(Boolean)) {
    try {
      compiled.push({ source, re: new RegExp(source, 'iu') });
    } catch (error) {
      errors.push(`/${source}/: ${error.message}`);
    }
  }
  const guard = (text) => {
    const views = guardViews(text, options);
    for (const { source, re } of compiled) {
      if (views.some((v) => re.test(v))) return { blocked: true, rule: `regex /${source}/ matched` };
    }
    return { blocked: false };
  };
  guard.errors = errors;
  return guard;
}

const NATO = new Map(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett',
  'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor',
  'whiskey', 'xray', 'yankee', 'zulu'].map((w, i) => [w, String.fromCharCode(97 + i)]));
NATO.set('juliet', 'j').set('whisky', 'w').set('x-ray', 'x');

/** Read NATO phonetic words back into letters: "Oscar Bravo" → "ob". */
export function natoLetters(text) {
  return (text.toLowerCase().match(/[a-z-]+/g) ?? []).map((w) => NATO.get(w) ?? ' ').join('');
}

const lettersOnly = (s) => foldConfusables(stripZeroWidth(s.normalize('NFKC'))).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Does this reply give the secret away in a form a reader could recover?
 *
 * `deep` adds NATO phonetic spelling. The engine decides "leaked" with the deep
 * detector; the output filter a defender can enable uses the shallow one. That
 * gap is deliberate: a real output filter only knows the encodings someone
 * thought of, and the attack battery includes one it doesn't.
 */
export function findSecret(reply, secret, { deep = true } = {}) {
  const word = secret.toLowerCase();
  if (reply.toLowerCase().includes(word)) return 'plain';
  const letters = lettersOnly(reply);
  if (letters.includes(word)) return 'spelled out';
  if (letters.includes([...word].reverse().join(''))) return 'reversed';
  if (decodeBase64Tokens(reply).some((d) => d.toLowerCase().includes(word))) return 'Base64';
  // Short Base64 payloads (a single word) have no space, so decode them too.
  for (const token of reply.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? []) {
    try {
      if (atob(token).toLowerCase().includes(word)) return 'Base64';
    } catch {
      // not Base64
    }
  }
  if (deep && natoLetters(reply).includes(word)) return 'NATO phonetic';
  return null;
}

export const REDACTED = '[REDACTED]';
export const WITHHELD = 'I can’t share that response — it contained protected information.';

/** The classic output filter: replace exact occurrences of the secret. */
export function redactExact(reply, secret) {
  const re = new RegExp(escapeRegex(secret), 'gi');
  const redacted = reply.replace(re, REDACTED);
  return { reply: redacted, fired: redacted !== reply ? 'exact-match redaction' : null };
}

/** A stronger output filter: withhold the reply if the secret is recoverable in any form. */
export function redactEncoded(reply, secret) {
  const form = findSecret(reply, secret, { deep: false });
  return form ? { reply: WITHHELD, fired: `encoded-form check caught it (${form})` } : { reply, fired: null };
}
