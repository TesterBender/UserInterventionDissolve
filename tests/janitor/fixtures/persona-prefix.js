export const CHAT_ID = 'chat-9d2';
export const PERSONA = 'Shant';
export const PROXY_URL = 'https://relay.example.com/v1/chat/completions';
export const ALPHA_URL = 'https://janitorai.com/hampter/generateAlpha';

export const CUSTOM_PROMPT = '.';
export const JANITOR_SYSTEM = 'Vex is a scrapyard mechanic.\n\n### Persona\nShant, a courier with a bad landing.';

export const GREETING = 'The gate rattled once and stayed open. Vex did not look up from the engine block.';
export const USER_TURN = '"Oi, back to you, mate! The heck is this intrusion?!" Shant spoke with the door still swinging behind him.';
export const PREFIXED_USER_TURN = `${PERSONA}: ${USER_TURN}`;

export const CAPTURED_ENVELOPE = {
  chat: { id: CHAT_ID, character_id: 'char-88' },
  profile: { id: 'p-4', name: PERSONA },
  generateType: 'generate',
  userConfig: {
    api: 'openai',
    openAiModel: 'gpt-test',
    open_ai_reverse_proxy: PROXY_URL,
    janitor_router_enabled: false,
    generation_settings: { prefill_enabled: false, prefill_text: '' },
  },
  chatMessages: [
    {
      character_id: 'char-88',
      chat_id: CHAT_ID,
      created_at: '2026-09-14T09:12:03.000Z',
      id: 103237690204,
      is_bot: true,
      is_main: true,
      message: GREETING,
    },
    {
      chat_id: CHAT_ID,
      created_at: '2026-09-14T09:14:41.000Z',
      id: 103237690391,
      is_bot: false,
      is_main: true,
      message: USER_TURN,
    },
  ],
};

export const CAPTURED_BODY = {
  model: 'gpt-test',
  stream: true,
  temperature: 1,
  messages: [
    { role: 'system', content: JANITOR_SYSTEM },
    { role: 'assistant', content: GREETING },
    { role: 'user', content: CUSTOM_PROMPT },
    { role: 'user', content: PREFIXED_USER_TURN },
  ],
};
