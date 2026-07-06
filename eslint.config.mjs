// Flat config (ESM). Adds ignores, Node + Vitest globals, and TS-friendly rule tweaks.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

function siblingGroups(folderNames) {
    return folderNames.flatMap((name) => [`../${name}`, `../${name}/*`, `../${name}/**`]);
}

function anyDepthFolderGroups(folderNames) {
    return folderNames.flatMap((name) => [`**/${name}`, `**/${name}/*`, `**/${name}/**`]);
}

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
            // Allow underscore-prefixed unused variables (common convention for intentionally unused params)
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // report an error if any circular dependency is found
            'import/no-cycle': ['error', { maxDepth: Infinity }],
            'no-useless-escape': 'off',
        },
    },

    {
        files: ['src/contentScript/shared/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups([
                                'tableModel',
                                'tableState',
                                'tableRuntime',
                                'tableWidget',
                                'tableCommands',
                                'nestedEditor',
                                'services',
                                'toolbar',
                            ]),
                            message: 'shared must stay feature-agnostic.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/contentScript/services/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups([
                                'tableModel',
                                'tableState',
                                'tableRuntime',
                                'tableWidget',
                                'tableCommands',
                                'nestedEditor',
                                'toolbar',
                            ]),
                            message: 'services may depend only on shared utilities and external integration code.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/contentScript/tableModel/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups([
                                'tableState',
                                'tableRuntime',
                                'tableWidget',
                                'tableCommands',
                                'nestedEditor',
                                'services',
                                'toolbar',
                            ]),
                            message: 'tableModel must not depend on higher-level editor layers.',
                        },
                        {
                            group: anyDepthFolderGroups([
                                'tableState',
                                'tableRuntime',
                                'tableWidget',
                                'tableCommands',
                                'nestedEditor',
                                'services',
                                'toolbar',
                            ]),
                            message:
                                'tableModel must not depend on higher-level editor layers, even via deep relative paths.',
                        },
                    ],
                    paths: [
                        {
                            name: '@codemirror/view',
                            message: 'tableModel must not depend on editor/runtime packages.',
                        },
                        {
                            name: '@codemirror/state',
                            message: 'tableModel must not depend on editor/runtime packages.',
                        },
                        {
                            name: '@codemirror/language',
                            message: 'tableModel must not depend on editor/runtime packages.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/contentScript/tableState/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups([
                                'tableRuntime',
                                'tableWidget',
                                'tableCommands',
                                'nestedEditor',
                                'services',
                                'toolbar',
                            ]),
                            message: 'tableState is limited to model types, shared helpers, and sibling state modules.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/contentScript/tableRuntime/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups(['tableCommands']),
                            message: 'tableRuntime must stay below tableCommands in the dependency graph.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/contentScript/tableCommands/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups(['tableWidget', 'nestedEditor', 'services']),
                            message:
                                'tableCommands should go through state/runtime APIs instead of widget or nested-editor internals.',
                        },
                    ],
                },
            ],
        },
    },

    {
        files: ['src/contentScript/tableWidget/**/*.ts'],
        ignores: ['src/contentScript/tableWidget/tableWidgetExtension.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: siblingGroups(['tableCommands']),
                            message:
                                'tableWidget modules must not depend on command registration or command entry points.',
                        },
                    ],
                },
            ],
        },
    },

    // Test + test support
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
                ...globals.vitest,
            },
        },
        rules: {
            // You can add test-specific overrides here later
        },
    },

    // Prettier compatibility
    prettier,
];
