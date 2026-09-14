import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * Flat config (ESLint 9). `--ext` is not supported in flat config, so the
 * globs here decide what gets linted and the lint script is `eslint .`.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,


      // Off in both flavours: a value and a type may share a name in TS
      // (`export const X` + `export type X`, or a lucide component beside a
      // local interface). Neither rule distinguishes those from a real
      // redeclaration, and tsc reports genuine ones as TS2451 anyway.
      'no-redeclare': 'off',

      // Existing debt, surfaced rather than enforced, so the config lands green.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',

      // TypeScript reports undefined identifiers itself, and the base rule
      // does not understand type-only references.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
