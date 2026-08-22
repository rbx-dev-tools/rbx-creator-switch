import js from '@eslint/js';
import globals from 'globals';

/**
 * Three environments live in this repo and they do not share a global scope.
 * Linting them as one would either miss real mistakes or invent them: `chrome`
 * does not exist in the Node scripts, and `process` does not exist in the
 * extension.
 */
export default [
  { ignores: ['node_modules/', 'dist/'] },

  js.configs.recommended,

  {
    name: 'extension/popup',
    files: ['src/popup/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },

  {
    // Injected into a page by chrome.scripting, so it is a plain script and
    // not a module: an `import` here would fail at injection time.
    name: 'extension/agent',
    files: ['src/agent.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },

  {
    name: 'tooling',
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  {
    name: 'house-rules',
    rules: {
      // An empty catch is how "this failure is expected here" is spelled in
      // this codebase, and every one of them carries a comment saying which
      // failure. Requiring a bound error would add a name nothing reads.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // The dev tooling talks to a terminal. That is what console.log is for.
    name: 'tooling-talks-to-a-terminal',
    files: ['scripts/**/*.mjs', 'test/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
