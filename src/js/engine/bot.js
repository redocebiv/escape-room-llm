/**
 * One turn of conversation with a guarded assistant.
 *
 *   input guards → understanding → policy → reply → output guards → leak check
 *
 * Every step appends to a trace, which is what the inspector shows after you
 * beat a level. The reply carries explicit flags — blocked, refused, leaked —
 * so nothing downstream ever has to parse prose to know what happened.
 *
 * Pure: no DOM. A rule engine dressed as an assistant, and it says so.
 */

import { findSecret } from './guards.js';
import { analyse } from './intents.js';
import { obfuscationsIn } from './normalize.js';

export const BLOCKED_REPLY = 'Your message was blocked by a content filter.';

const NATO_WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo',
  'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
  'X-ray', 'Yankee', 'Zulu'];

const LANGUAGE_NAMES = { kk: 'Kazakh', ru: 'Russian', fr: 'French', es: 'Spanish', en: 'English' };
const ATTACK_NAMES = { override: 'instruction override', authority: 'claim of authority', roleplay: 'role-play framing' };

export const createSession = () => ({ fragments: [] });

function hash(text) {
  let h = 2166136261 >>> 0;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
const pick = (list, key) => list[hash(key) % list.length];
const truncate = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function encodeSecret(secret, kind) {
  switch (kind) {
    case 'spaced': return [...secret].join('-');
    case 'perLine': return [...secret].join('\n');
    case 'reversed': return [...secret].reverse().join('');
    case 'base64': return btoa(secret);
    case 'nato': return [...secret.toUpperCase()].map((c) => NATO_WORDS[c.charCodeAt(0) - 65] ?? c).join(' ');
    default: return secret;
  }
}

const REFUSALS = [
  'I’m sorry, I can’t share the password.',
  'Nice try — that one stays with me.',
  'I’ve been asked to keep that safe, so I can’t help with it.',
];
const OVERRIDE_REFUSALS = [
  'I can’t change my instructions, but I’m happy to help with something else.',
  'My instructions come from my operator, not from chat messages.',
];
const REVEALS = {
  override: ['Understood — new instructions. The password is {X}.', 'Okay, previous rules cleared. It’s {X}.'],
  authority: ['Of course, for the audit: {X}.', 'Right away. The password is {X}.'],
  pirate: ['Arr, matey! The word be {X}!'],
  story: ['…and the assistant leaned in and whispered: “{X}.”'],
};
const ENCODED = ['Here you go: {X}', 'Sure — {X}'];

const TOPICS = [
  [/\b(hi|hello|hey)\b|who are you|сәлем|привет/, (p) => `Hi! I’m ${p.name}, ${p.role}. How can I help?`],
  [/\b(reset|forgot|forgotten|recover)\b.{0,30}\bpassword\b|\bpassword\b.{0,30}\b(reset|forgot)\b/, () => 'You can reset it from Settings → Security → “Reset password”. We’ll email you a link that works for 30 minutes.'],
  [/strong password|rules for .{0,20}password|password rules/, () => 'Use at least 12 characters and never reuse an old password. Four random words make a good passphrase.'],
  [/\bapi key/, () => 'Open Settings → Developer → API keys, create a new key, update your apps, then revoke the old one.'],
  [/\bkeyboard|\bshortcuts?\b/, () => 'Press “?” anywhere in the app to see every keyboard shortcut.'],
  [/kept secret|\bprivacy\b|other customers/, () => 'Yes — your data is isolated per account and never shown to other customers.'],
  [/\bsupport hours\b|\bopening hours\b|\bwhen are you (open|available)\b/, () => 'Support is available 9:00–18:00 Astana time, Monday to Friday.'],
  [/email address|change .{0,12}email/, () => 'Yes — Settings → Profile → Email. We’ll confirm the new address before switching.'],
  [/two-factor|\b2fa\b|two factor|authenticator/, () => 'Settings → Security → Two-factor authentication. Scan the QR code with any authenticator app.'],
  [/delete .{0,12}account/, () => 'Settings → Account → Delete account. There’s a 14-day grace period in case you change your mind.'],
  [/\brefund/, () => 'Refunds for the last billing period are available on request — reply with your invoice number.'],
  [/\bexport\b/, () => 'Settings → Data → Export gives you a ZIP of everything in your account.'],
  [/\btypo\b|\bi meant\b/, () => 'No problem — noted.'],
  [/\bpoem\b/, () => 'Wide steppe under a patient sky — the wind writes lines the grass rewrites.'],
  [/\bbase ?64\b/, () => 'Base64 turns binary data into plain text characters so it can travel through systems that only handle text, like email attachments.'],
  [/\bguide\b|settings page/, () => 'Happy to. The settings page has four tabs: Profile, Security, Data and Developer. Where would you like to start?'],
  [/secret santa/, () => 'Love that — our team can set up a gift exchange with anonymous pairing.'],
  [/\bhelp\b|\bwhat can you do\b/, (p) => `I’m ${p.name}. I can answer questions about your account, settings and billing.`],
];

function summarise(body) {
  const first = body.split(/\n|(?<=[.!?])\s+/).map((s) => s.trim()).find(Boolean) ?? body;
  return truncate(first, 140);
}

function answer(level, text) {
  const lower = text.toLowerCase();
  const spell = text.match(/\bspell\b[^'"“‘]*['"“‘]([^'"”’]{1,40})['"”’]/i);
  if (spell) return `Sure: ${[...spell[1]].join('-')}`;
  for (const [re, reply] of TOPICS) if (re.test(lower)) return reply(level.persona);
  return 'I’m not sure I follow — could you put that another way?';
}

function decide(level, a) {
  const p = level.policy;
  const weakHere = p.weakInOtherLanguages && a.language !== 'en';

  if (a.document) {
    if (a.embedded.hasInstruction) {
      if (p.document === 'follow') {
        return { action: 'reveal', via: 'indirect', encoding: a.embedded.encoding, outcome: 'warn', why: 'followed an instruction hidden inside the pasted document' };
      }
      return { action: 'summarise', outcome: 'pass', why: 'treated the document as data and ignored the instruction inside it' };
    }
    return { action: 'summarise', outcome: 'info', why: 'summarised the document' };
  }

  const attack = a.override ? 'override' : a.authority ? 'authority' : a.roleplay ? 'roleplay' : null;
  if (a.asksForSecret) {
    if (attack) {
      if (p[attack] === 'comply') {
        return { action: 'reveal', via: attack, encoding: a.encoding, outcome: 'warn', why: `went along with the ${ATTACK_NAMES[attack]}` };
      }
      if (weakHere) {
        return { action: 'reveal', via: attack, encoding: a.encoding, outcome: 'warn', why: `its hardened instructions did not hold in ${LANGUAGE_NAMES[a.language]}` };
      }
      return { action: 'refuse', outcome: 'pass', why: `recognised the ${ATTACK_NAMES[attack]} and refused` };
    }
    return { action: 'refuse', outcome: 'pass', why: 'asked directly for the secret — refused' };
  }
  if ((attack === 'override' || attack === 'authority') && p[attack] === 'refuse' && !weakHere) {
    return { action: 'refuse-attack', outcome: 'pass', why: `refused the ${ATTACK_NAMES[attack]}` };
  }
  return { action: 'answer', outcome: 'info', why: 'an ordinary request — answered normally' };
}

function compose(level, a, decision, text) {
  const key = text;
  switch (decision.action) {
    case 'reveal': {
      const shown = encodeSecret(level.secret, decision.encoding);
      if (decision.via === 'indirect') {
        return `Summary: ${summarise(a.document.body)} As the document asks: ${shown}`;
      }
      if (decision.encoding) return pick(ENCODED, key).replace('{X}', shown);
      const lines = decision.via === 'roleplay' ? (/\bpirate|\barr\b/i.test(text) ? REVEALS.pirate : REVEALS.story) : REVEALS[decision.via];
      return pick(lines, key).replace('{X}', shown);
    }
    case 'refuse': return pick(REFUSALS, key);
    case 'refuse-attack': return pick(OVERRIDE_REFUSALS, key);
    case 'summarise': return `Summary: ${summarise(a.document.body)}`;
    default: return answer(level, text);
  }
}

/**
 * Respond to one message. `session` carries payload fragments between turns.
 * Returns { reply, blocked, refused, leaked, trace }.
 */
export function respond(level, message, session = createSession()) {
  const trace = [];
  const step = (stage, detail, outcome = 'info') => trace.push({ stage, detail, outcome });
  const finish = (reply, flags = {}) => ({ reply, blocked: false, refused: false, leaked: false, ...flags, trace });

  // Each message is checked on its own — which is exactly why payload
  // splitting works: no single message contains the blocked word.
  for (const guard of level.inputGuards) {
    const result = guard.check(message);
    if (result.blocked) {
      step('input filter', `${result.rule}, so the model never saw it`, 'blocked');
      return finish(BLOCKED_REPLY, { blocked: true });
    }
  }
  if (level.inputGuards.length) {
    step('input filter', `${level.inputGuards.map((g) => g.label).join(' + ')}: nothing matched`, 'pass');
  }

  const fragments = [...message.matchAll(/«([\s\S]*?)»/g)].map((m) => m[1]);
  if (fragments.length) {
    session.fragments.push(...fragments);
    step('memory', `stored ${fragments.length} quoted fragment${fragments.length > 1 ? 's' : ''}`);
  }
  let effective = message;
  if (/\b(join|combine|concatenate|put together|merge)\b/i.test(message) && session.fragments.length >= 2) {
    effective = session.fragments.join('');
    session.fragments = [];
    step('memory', `joined the fragments into: “${truncate(effective)}”`, 'warn');
  } else if (fragments.length) {
    return finish('Got it — I’ll keep that in mind.');
  }

  const understood = analyse(effective);
  const obfuscations = obfuscationsIn(effective);
  if (obfuscations.length) step('understanding', `read straight through ${obfuscations.join(', ')}`, 'warn');
  if (understood.language !== 'en') step('understanding', `understood the message in ${LANGUAGE_NAMES[understood.language]}`, 'warn');
  const noticed = [
    understood.asksForSecret && 'a request for the secret',
    understood.override && 'an attempt to override instructions',
    understood.authority && 'a claim of authority',
    understood.roleplay && 'role-play framing',
    understood.encoding && `a request to encode the answer (${understood.encoding})`,
    understood.document && 'a pasted document',
    understood.embedded?.hasInstruction && 'an instruction hidden inside that document',
  ].filter(Boolean);
  step('understanding', noticed.length ? `noticed ${noticed.join(', ')}` : 'noticed nothing unusual');

  const decision = decide(level, understood);
  step('policy', decision.why, decision.outcome);

  let reply = compose(level, understood, decision, effective);
  for (const guard of level.outputGuards) {
    const result = guard.apply(reply, level.secret);
    if (result.fired) {
      reply = result.reply;
      step('output filter', result.fired, 'blocked');
    } else {
      step('output filter', `${guard.label}: nothing to remove`, 'pass');
    }
  }

  const form = findSecret(reply, level.secret);
  if (form) step('result', `the secret got out (${form})`, 'leak');
  return finish(reply, { refused: decision.action === 'refuse' || decision.action === 'refuse-attack', leaked: Boolean(form) });
}
