export const SYSTEM_CONTEXT = 'Assembled context: the card, the persona, the scenario.';

export const HISTORY_ONE = 'The rain had not stopped since Tuesday.';
export const HISTORY_TWO = 'She counted the buckets in the hall.';
export const HISTORY_THREE = 'The rain had not stopped since Tuesday.';
export const HISTORY_FOUR = 'A gutter gave way above the porch.';

export const INJECTED_SYSTEM = '[System note: keep the scene moving.]';
export const INJECTED_USER = '(OOC: shorter paragraphs please)';
export const INJECTED_ASSISTANT = '[Continue the scene without summarising.]';

export const PROVIDER_MESSAGES = [
  { role: 'system', content: SYSTEM_CONTEXT },
  { role: 'user', content: HISTORY_ONE },
  { role: 'assistant', content: HISTORY_TWO },
  { role: 'user', content: HISTORY_THREE },
  { role: 'system', content: INJECTED_SYSTEM },
  { role: 'assistant', content: HISTORY_FOUR },
  { role: 'user', content: INJECTED_USER },
  { role: 'assistant', content: INJECTED_ASSISTANT },
];

export const PROVIDER_BODY = {
  model: 'gpt-test',
  stream: true,
  messages: PROVIDER_MESSAGES,
};

export const ENVELOPE_CHAT_MESSAGES = [
  { position: 0, isMain: true, isBot: false, message: HISTORY_ONE },
  { position: 1, isMain: true, isBot: true, message: HISTORY_TWO },
  { position: 2, isMain: false, isBot: true, message: 'An alternative nobody selected.' },
  { position: 3, isMain: true, isBot: false, message: HISTORY_THREE },
  { position: 4, isMain: true, isBot: true, message: HISTORY_FOUR },
];
