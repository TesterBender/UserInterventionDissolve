export const CHAT_ID = 'chat-mx1';
export const PERSONA = 'Mara';
export const PROXY_URL = 'https://relay.example.com/v1/chat/completions';
export const ALPHA_URL = 'https://janitorai.com/hampter/generateAlpha';
export const JANITOR_SYSTEM = "Nyx is a lighthouse keeper.\n\n### Hidden context\nThe reader's name is account_holder_92.";
export const PREFILL_TEXT = 'The lamp turned,';

export function prose(tag, sentences, actor = 'Keeper') {
  const lines = [];
  for (let i = 0; i < sentences; i += 1) {
    lines.push(`${tag} ${i} the lamp turned once more over slow iron rain and salt.`);
  }
  const paragraphs = [];
  for (let i = 0; i < lines.length; i += 10) paragraphs.push(lines.slice(i, i + 10).join(' '));
  return `${actor}:\n${paragraphs.join('\n\n')}`;
}

export function envelopeFor(turns, options = {}) {
  return {
    chat: { id: options.chatId ?? CHAT_ID, character_id: 'char-3' },
    profile: { id: 'p-1', name: options.persona ?? PERSONA },
    generateType: 'generate',
    userConfig: {
      api: 'openai',
      openAiModel: 'gpt-test',
      open_ai_reverse_proxy: PROXY_URL,
      janitor_router_enabled: false,
      generation_settings: { prefill_enabled: true, prefill_text: PREFILL_TEXT },
    },
    chatMessages: turns.map((turn) => ({
      is_bot: turn.role !== 'user',
      is_main: true,
      message: turn.content,
    })),
  };
}

export function bodyFor(turns, options = {}) {
  const messages = [{ role: 'system', content: options.system ?? JANITOR_SYSTEM }];
  for (const turn of turns) messages.push({ role: turn.role, content: turn.content });
  for (const injection of options.injections ?? []) {
    messages.splice(injection.at, 0, { role: injection.role, content: injection.content });
  }
  if (options.prefill) messages.push({ role: 'assistant', content: options.prefill });
  return { model: 'gpt-test', stream: true, temperature: 1, messages };
}

export function storedState(overrides = {}) {
  return {
    version: 3,
    frozen: [],
    units: [],
    frozenIds: [],
    watermark: { messageId: null, offset: 0 },
    literal: '',
    boundaries: [],
    watermarkText: '',
    ...overrides,
  };
}
