import { METADATA_KEY } from '../src/constants.js';

// envelope-id: identity is read off the entry alignment chose → docs/modules/janitor-adapter.md#envelope-id-identity
function entryId(entry) {
  return typeof entry.id === 'string' ? entry.id : '';
}

// two-cursor-diff: envelope entries decide history, roles decide nothing → docs/modules/janitor-adapter.md#envelope-diff
// no-envelope-fallback: without a record every non-system message is history → docs/modules/janitor-adapter.md#envelope-diff
export function classifyMessages(messages, envelopeChatMessages, personaName) {
  const mains = Array.isArray(envelopeChatMessages)
    ? envelopeChatMessages.filter((entry) => entry.isMain === true)
    : [];

  const prefix = personaName ? `${personaName}: ` : '';
  const history = [];
  const injections = [];
  let systemIndex = -1;
  let cursor = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const role = messages[index].role;
    const content = messages[index].content;

    // assembled-context: the first system turn is the card, not a turn → docs/modules/janitor-adapter.md#envelope-diff
    if (systemIndex === -1 && (role === 'system' || role === 'developer')) {
      systemIndex = index;
      continue;
    }

    const entry = { index, role, content };
    if (mains.length === 0) {
      history.push({ ...entry, messageId: '' });
      continue;
    }

    if (cursor < mains.length && mains[cursor].message === content) {
      history.push({ ...entry, messageId: entryId(mains[cursor]) });
      cursor += 1;
      continue;
    }

    // persona-prefix-align: user turns arrive as `Name: text`; history carries the bare text → docs/modules/janitor-adapter.md#envelope-diff
    if (cursor < mains.length && role === 'user' && prefix !== '' && content === prefix + mains[cursor].message) {
      history.push({ index, role, content: mains[cursor].message, messageId: entryId(mains[cursor]) });
      cursor += 1;
      continue;
    }

    injections.push(entry);
  }

  return { history, injections, systemIndex };
}

// st-shape: the four fields deriveFrontier reads, no name invented → docs/modules/janitor-adapter.md#st-shape-shim
export function toStShape(historyMessages) {
  return historyMessages.map((message) => ({
    mes: message.content,
    is_user: message.role === 'user',
    is_system: false,
    extra: { [METADATA_KEY]: { id: message.messageId } },
  }));
}

// provider-shape: exact inverse of buildHistory's output → docs/modules/janitor-adapter.md#st-shape-shim
export function fromStShape(history) {
  return history.map((message) => ({
    role: message.is_user === true ? 'user' : 'assistant',
    content: message.mes,
  }));
}
