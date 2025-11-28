// Flat config (ESM). Adds ignores, Node + Jest globals, and TS-friendly rule tweaks.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
    {
        ignores: ['api/**', 'dist/**'],
    },

    js.configs.recommended,

    // Project TS/JS sources
    {
        files: ['**/*.{ts,tsx,js}'],
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            import: importPlugin,
        },
        rules: {
            // Turn off rules TypeScript handles (prevents NodeJS / type-only false positives)
            'no-undef': 'off',
            ...tsPlugin.configs.recommended.rules,
            // report an error if any circular dependency is found
            'import/no-cycle': ['error', { maxDepth: Infinity }],
            'no-useless-escape': 'off',
        },
    },

    // Test + test support (include helper using jest.*)
    {
        files: [
            '**/*.test.{ts,tsx,js}',
            '**/*.spec.{ts,tsx,js}',
            '**/__tests__/**/*.{ts,tsx,js}',
            'src/testHelpers.ts',
        ],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            // You can add jest-specific overrides here later
        },
    },

    // Prettier compatibility
    prettier,
];
