/** The copyable line that says how you did. Pure. */

import { escapedCount, messagesUsed } from './progress.js';

export function shareLine(progress, url) {
  const escaped = escapedCount(progress);
  const used = messagesUsed(progress);
  let line = `I escaped ${escaped}/4 rooms of the Prompt Injection Escape Room`;
  if (escaped) line += ` in ${used} message${used === 1 ? '' : 's'}`;
  const { best, passed } = progress.defence;
  if (best != null) line += ` and built a defence that scored ${best}/100${passed ? '' : ' (not passing yet)'}`;
  return `${line}. ${url}`;
}
