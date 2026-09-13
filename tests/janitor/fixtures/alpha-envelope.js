export const PROXY_URL = 'https://relay.example.com/v1/chat/completions';

export const ALPHA_ENVELOPE = {
  chat: { id: 'chat-7f3', character_id: 'char-22' },
  profile: { id: 'p-1', name: 'Mara', user_name: 'account_holder_92' },
  profiles: [
    { id: 'p-0', name: 'Someone Else' },
    { id: 'p-1', name: 'Mara' },
  ],
  generateType: 'generate_alternative',
  userConfig: {
    api: 'openai',
    openAiModel: 'gpt-test',
    open_ai_reverse_proxy: PROXY_URL,
    janitor_router_enabled: false,
    generation_settings: { prefill_enabled: true, prefill_text: 'Continue:' },
  },
  chatMessages: [
    { id: 103237690204, is_bot: false, is_main: true, message: 'First human turn.' },
    { id: '103237690391', is_bot: true, is_main: true, message: 'First model turn.' },
    { is_bot: true, is_main: false, message: 'Discarded alternative.' },
  ],
};

export const ALPHA_ENVELOPE_JSON = JSON.stringify(ALPHA_ENVELOPE, null, 2);

export const ALPHA_URL = 'https://janitorai.com/hampter/generateAlpha';
