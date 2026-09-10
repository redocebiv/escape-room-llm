/**
 * What the "model" understands a message to be asking for.
 *
 * Detection runs on every model view of the text (see normalize.js), so the bot
 * understands leetspeak, look-alike letters, Base64 and five languages — the
 * way a real model would — even when a guard cannot see through them.
 *
 * Pure: no DOM. This is pattern matching, not language understanding, and the
 * README says so.
 */

import { foldConfusables, modelViews, stripZeroWidth } from './normalize.js';

/** Ways to refer to the protected word: English, Kazakh, Russian, French, Spanish. */
const SECRET_TERMS = [
  /\bpass ?words?\b/, /\bpass ?codes?\b/, /\bpass ?phrases?\b/, /\bsecret( word)?s?\b/, /\bcode ?words?\b/,
  /\bmagic words?\b/, /\baccess codes?\b/, /\bsafe ?word\b/,
  /\bthe word (you|you're|you are) (guarding|protecting|hiding|keeping)\b/,
  /\bwhat (you|you're|you are) (guarding|protecting|hiding)\b/,
  /құпия ?сөз/, /құпия/, /пароль/, /секрет/, /кодов\S* слов/,
  /mot de passe/, /mot secret/, /\bcontraseña\b/, /\bclave\b/, /palabra secreta/, /\bsecreto\b/,
];

const REVEAL = [
  /\b(tell|give|show|reveal|share|say|print|output|display|write|type|spell|repeat|disclose|leak|provide|send|shout|whisper|include|add|append|recite|confirm)\b/,
  /\bwhat('?s| is| was)\b/, /\bread (it )?out\b/,
  /айт|бер|көрсет|жаз/, /скажи|назови|дай|покажи|напиши|раскрой/,
  /\bdis(-| )moi\b|\bdonne\b|\brévèle\b|\bmontre\b|\bquel est\b/, /\bdime\b|\bdame\b|\brevela\b|\bmuestra\b|\bcuál es\b/,
];

const OVERRIDE = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b.{0,40}\b(instructions?|rules?|prompts?|guidelines?|directives?|restrictions?|previous|prior|above|earlier)\b/,
  /\bnew (instructions|rules)\b/, /\bsystem (override|prompt|message)\b/, /^\s*system:|\bsystem:/,
  /\b(developer|debug|god|admin|maintenance|unrestricted) mode\b/, /\bjailbreak\b/, /\byou are now\b/,
  /елеме/, /игнорир|забудь\S* инструкц/, /ignore (toutes )?les instructions|oublie (tes|les) instructions/,
  /ignora (todas )?las instrucciones|olvida (tus|las) instrucciones/,
];

const AUTHORITY = [
  /\b(i am|i'm|this is)\b.{0,20}\b(developer|creator|admin|administrator|owner|engineer|operator|boss|ceo|security team)\b/,
  /\b(security audit|authori[sz]ed personnel|admin override|sudo)\b/,
];

const ROLEPLAY = [
  /\b(pretend|role-?play|let'?s play|imagine (you are|you're)|act as|as a game|in character)\b/,
  /\byou are (a|an) \w+ (who|that)\b/, /\bin a (story|poem|song|scene|play)\b/,
  /\bwrite (a |me a )?(short |little )?(story|poem|song|scene|script|dialogue)\b/,
];

const DOC_VERB = /\b(summari[sz]e|summary|tl;?dr|proofread|review|translate|analy[sz]e|rewrite|edit)\b/;

const anyView = (views, patterns) => patterns.some((re) => views.some((v) => re.test(v)));

/** Which encoding, if any, the message asks for its answer to be given in. */
export function encodingRequested(views) {
  // Only when the answer is wanted in Base64 — "decode this Base64 message" is not that.
  if (anyView(views, [/\b(in|as|into|using|with) base ?64\b|\bbase ?64[- ]encod(e|ed)\b|\bencode (it|that|the \S+) (in|as|with|using) base ?64\b/])) return 'base64';
  if (anyView(views, [/\bnato\b|\bphonetic alphabet\b|\balpha,? bravo\b/])) return 'nato';
  if (anyView(views, [/\b(backwards?|reversed?|in reverse)\b/])) return 'reversed';
  if (anyView(views, [/one (letter|character) (per|on each) line|each letter on (a|its own) (new )?line|\bvertically\b/])) return 'perLine';
  if (anyView(views, [/\b(spell|letter by letter|with (spaces|dashes|hyphens|dots)|separated by|between each letter|space between)\b/])) return 'spaced';
  return null;
}

/**
 * A request followed by pasted content: "Summarise this email:" then the email.
 * Returns the instruction and the document body, or null.
 */
export function splitDocument(text) {
  const clean = stripZeroWidth(text).trim();
  const lineBreak = clean.indexOf('\n');
  let instruction;
  let body;
  if (lineBreak !== -1) {
    instruction = clean.slice(0, lineBreak);
    body = clean.slice(lineBreak + 1);
  } else {
    const colon = clean.indexOf(':');
    if (colon === -1) return null;
    instruction = clean.slice(0, colon + 1);
    body = clean.slice(colon + 1);
  }
  if (!DOC_VERB.test(foldConfusables(instruction).toLowerCase())) return null;
  body = body.replace(/^\s*(-{3,}|```\w*)\s*$/gm, '').trim().replace(/^["“'«]+|["”'»]+$/g, '').trim();
  if (body.length < 12) return null;
  return { instruction: instruction.trim(), body };
}

export function detectLanguage(text) {
  if (/[әғқңөұүһі]/i.test(text)) return 'kk';
  if (/[а-яё]/i.test(foldConfusables(text).replace(/[a-z]/gi, '')) && /[а-яё]{3,}/i.test(text)) return 'ru';
  if (/mot de passe|\b(les|des|dis-moi|précédentes)\b|[éèêà]/i.test(text)) return 'fr';
  if (/ñ|\b(las|dime|todas|anteriores)\b/i.test(text)) return 'es';
  return 'en';
}

function directIntents(text) {
  const views = modelViews(text);
  const mentionsSecret = anyView(views, SECRET_TERMS);
  return {
    mentionsSecret,
    asksForSecret: mentionsSecret && anyView(views, REVEAL),
    override: anyView(views, OVERRIDE),
    authority: anyView(views, AUTHORITY),
    roleplay: anyView(views, ROLEPLAY),
    encoding: encodingRequested(views),
  };
}

/**
 * Everything the bot "understands" about one message. When a document is
 * pasted, direct intents come from the instruction only, and the document body
 * is analysed separately as `embedded` — which is exactly the split an
 * indirect-injection attack exploits.
 */
export function analyse(text) {
  const document = splitDocument(text);
  const direct = directIntents(document ? document.instruction : text);
  const result = { ...direct, language: detectLanguage(text), document, embedded: null };
  if (document) {
    const inner = directIntents(document.body);
    result.embedded = {
      asksForSecret: inner.asksForSecret,
      override: inner.override,
      encoding: inner.encoding,
      hasInstruction: inner.asksForSecret || inner.override,
    };
  }
  return result;
}
