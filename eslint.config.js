import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly', document: 'readonly', globalThis: 'readonly', console: 'readonly',
  localStorage: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  SillyTavern: 'readonly', toastr: 'readonly', jQuery: 'readonly', $: 'readonly',
};
const nodeGlobals = { process: 'readonly', Buffer: 'readonly', URL: 'readonly' };

export default [
  { ignores: ['node_modules/**', 'docs/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browserGlobals },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' }],
    },
  },
  { files: ['tests/**', 'tools/**'], languageOptions: { globals: { ...browserGlobals, ...nodeGlobals } } },
];
