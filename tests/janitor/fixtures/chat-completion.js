export const CHAT_COMPLETION = {
  model: 'gpt-test',
  stream: true,
  temperature: 1,
  messages: [
    { role: 'system', content: 'You are writing a scene from notes.' },
    { role: 'user', content: 'Mara:\nShe pushed the door open.' },
    { role: 'assistant', content: 'The hinge complained.' },
    { role: 'user', content: '//' },
  ],
};

export const CHAT_COMPLETION_JSON = JSON.stringify(CHAT_COMPLETION, null, 2);
