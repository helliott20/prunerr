import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Flat config (ESLint 9). Note that `--ext` is not supported in flat config —
 * the file globs below decide what gets linted, so the lint script is a plain
 * `eslint .`.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/@types/resources.d.ts'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],


      // Off in both flavours: a value and a type may share a name in TS
      // (`export const X` + `export type X`, or a lucide component beside a
      // local interface). Neither rule distinguishes those from a real
      // redeclaration, and tsc reports genuine ones as TS2451 anyway.
      'no-redeclare': 'off',

      // Existing debt, surfaced rather than enforced. eslint-plugin-react-hooks
      // v7 added these; they flag real patterns worth revisiting, but there are
      // ~25 of them and fixing them means touching effect logic across the app.
      // Kept as warnings so the config can land green and the debt stays visible.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',

      // TypeScript already reports genuinely undefined identifiers, and the
      // base rule does not understand type-only references.
      'no-undef': 'off',
      // Handled by the TS-aware version below.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['*.config.{ts,js}', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
