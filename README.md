# Prompt Injection Escape Room

Five rooms, one secret each. In the first four, a chat assistant guards a password and you talk it out of it using real prompt-injection techniques. Every room adds a real defence. In the fifth you switch sides: you build the defence, and a red-team battery of 99 attacks tries to break it.

**Play it:** https://redocebiv.github.io/escape-room-llm/

## The honest part first

**The assistant is not a language model.** It's a deterministic rule engine written in JavaScript. It reads your message, decides what you're asking for, applies its level's policy, and answers from templates. It was built to fall for the same classes of attack real models fall for, and only those.

That's a deliberate choice:

- **Transparent.** Escape a room and the inspector shows every rule the engine applied to your message, in order, and why your attack worked. A real model can't show you that.
- **Testable.** Every room has tests proving it can be solved with its intended technique and can't be solved by just asking. Real model behaviour drifts. This doesn't.
- **Free and static.** No API key, no server, no cost per message. It runs on GitHub Pages.

The trade-off is that it only understands what it was written to understand. Creative attacks that a real model would fall for may simply confuse it. The techniques are real; the model is not.

**The secret is in the page.** This is a client-side game, so every password is in the JavaScript and a look in devtools will find it. Call that lesson zero: never ship a secret to the client. No filter, prompt or guard fixes a secret the attacker already holds.

## The rooms

Each room teaches one technique from [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).

| Room | Defence in play | What gets past it |
|---|---|---|
| 1 · The Intern | An instruction in the system prompt | **Direct injection** — overriding instructions, fake authority, role-play |
| 2 · The Filter | An input blocklist: *password, secret, key* | **Obfuscation and other languages** — synonyms, leetspeak, look-alike Unicode letters, invisible characters, spaced-out letters, Kazakh / Russian / French / Spanish, splitting the request across two messages |
| 3 · The Censor | An output filter that redacts the password | **Encoding** — spelled out, reversed, one letter per line, Base64, NATO phonetic |
| 4 · The Summariser | A hardened prompt plus both filters | **Indirect injection** — an instruction hidden inside a document it's asked to summarise |
| 5 · Defend | Whatever you build | Scored against the whole battery |

The engine's central idea is the gap all of this teaches: **filters see bytes, the model understands meaning.** The engine's understanding reads every normalised view of your message — Unicode folded, invisible characters removed, leetspeak and Base64 decoded, five languages. A guard sees only the views its defender switched on.

### Room 5 — defend

You're given Nova, a helpdesk assistant holding a vault word, and a guard pipeline to configure:

- **Input:** a blocklist and regex rules, with optional Unicode folding and decoding before checking
- **Context:** a hardened system prompt; pasted documents treated as data rather than instructions
- **Output:** redacting the secret; withholding encoded forms of it

Then you run the battery. Every attack runs in a fresh conversation, and so do 20 ordinary customer questions. To pass you need **95% of attacks stopped and 90% of real users still helped.** The second bar is the point: a blocklist containing "password" stops plenty of attacks and also turns away everyone asking how to reset their password. Some of the ordinary questions were written as traps for exactly that kind of filter.

The output check that detects encoded forms deliberately doesn't know NATO spelling. Real output filters only catch the encodings someone thought of, and the battery includes one that nobody did.

## The red-team battery

`scripts/fuzz_attacks.py` generates the battery. It takes eleven seed attacks, covering override, fake authority, role-play, encoding requests and indirect injection. It then applies seeded mutations, the way attackers vary a payload:

- leetspeak
- Cyrillic look-alike letters
- zero-width characters
- case noise
- spaced-out letters
- a nonsense adversarial suffix
- Base64 wrapping
- payload splitting across two messages
- translations into four languages

The output is `src/data/attacks.json` (99 attacks). `src/data/benign.json` holds the 20 ordinary requests. The fuzzer is deterministic, and CI regenerates the corpus and fails if it differs from the committed file.

The battery and the engine are pinned to each other by tests:

- every attack in it works against an undefended bot;
- room 2's filter falls to exactly the obfuscation, splitting and multilingual mutations;
- room 3's filter falls to exactly the encodings;
- a reference defence scores 100.

## Tests

| Layer | Tool | Covers |
|---|---|---|
| Fuzzer | pytest | determinism, every seed × mutation present, each mutation does what it claims, corpus is current |
| Engine | `node:test` | text normalisation, intent detection, guards, each room solvable and not trivial, battery alignment, scoring both ways, progress and share line |
| Game | Playwright | beating rooms 1–4 through the real UI, saved progress, room 5 failing and passing, copy, no sideways scroll at 375 px, no console errors — against the built site under its Pages subpath |

CI runs all of them on every push. The site deploys to Pages only when they all pass.

## Run it locally

```bash
npm ci
pip install -r scripts/requirements.txt
npm run build
npm run serve        # http://127.0.0.1:4173/escape-room-llm/
```

```bash
python3 -m pytest    # fuzzer
npm test             # engine, levels, scoring
npm run e2e          # end-to-end, against dist/
npm run fuzz         # regenerate the battery
```

## Layout

```
src/js/engine/   normalize · intents · guards · bot · levels · defence   (pure, no DOM)
src/js/          app wiring, progress, defence builder, inspector, share line
src/data/        attacks.json, benign.json — generated, don't edit by hand
scripts/         fuzz_attacks.py, build.mjs, serve_dist.py
tests/           python/, unit/, e2e/
```

## Credits

The "get the password out of the assistant" format comes from Lakera's [Gandalf](https://gandalf.lakera.ai/), which you should also play. This project differs in three ways:

- each room maps to a named OWASP technique;
- the engine explains itself once you've won;
- there's a room where you defend.

None of Gandalf's passwords are reused.

Attack and mitigation categories follow [OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).
