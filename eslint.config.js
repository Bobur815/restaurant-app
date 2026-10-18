const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const globals = require('globals');

/**
 * Flat config for ESLint 9, ported from posgro without the React rules.
 * Not type-aware (no parserOptions.project): `npm run typecheck` covers types, ESLint covers the rest.
 */

const IGNORES = [
  'dist/**',
  'dist-electron/**',
  'dist-renderer/**',
  'release/**',
  'coverage/**',
  'node_modules/**',
  '**/node_modules/**',
  'legacy/**',
  // Generated Prisma client (Phase 2), gitignored.
  'src/generated/**',
];

const TS_FILES = ['src/**/*.ts'];
const RENDERER_FILES = ['src/renderer/**/*.ts'];

module.exports = [
  { ignores: IGNORES },

  // ── Plain JavaScript: config files and build scripts ─────────────────────────────────────
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: js.configs.recommended.rules,
  },

  // ── TypeScript ─────────────────────────────────────────────────────────────────────────────
  // Core rules first so the plugin's `eslint-recommended` can switch off what tsc does better.
  { files: TS_FILES, rules: js.configs.recommended.rules },

  ...tseslint.configs['flat/recommended'].map((config) => ({ ...config, files: TS_FILES })),

  {
    files: TS_FILES,
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // ESC/POS sequences and scanner delimiters (Phase 7) legitimately match control characters.
      'no-control-regex': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── Renderer: no Node, no raw HTML sinks ───────────────────────────────────────────────────
  // Data reaches the DOM through textContent or the escaping html`` helper (Phase 5). The one
  // place allowed to assign markup is that helper, which disables this rule locally.
  {
    files: RENDERER_FILES,
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Use textContent or the html`` helper (escapes by default).',
        },
        {
          property: 'outerHTML',
          message: 'Use textContent or the html`` helper (escapes by default).',
        },
        { property: 'insertAdjacentHTML', message: 'Use the html`` helper (escapes by default).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*', 'fs', 'path', 'child_process'],
              message: 'The renderer reaches the system only through window.electronAPI.',
            },
            {
              group: ['@main/*'],
              message: 'Import shared types from @shared, not from the main process.',
            },
          ],
        },
      ],
    },
  },

  // ── Tests ──────────────────────────────────────────────────────────────────────────────────
  {
    files: ['**/*.test.ts'],
    rules: {
      // require() after jest.mock() hoisting is how a mocked module is reached.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
