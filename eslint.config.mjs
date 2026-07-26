// Flat config (ESM). Adds ignores, Node + Vitest globals, and TS-friendly rule tweaks.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
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
    unicorn.configs.unopinionated,

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

            // --- eslint-plugin-unicorn opt-outs ---
            //
            // Group 1: rules that push APIs newer than our runtime baseline.
            // The manifest declares `platforms: ["desktop", "mobile"]`, and the
            // build is ts-loader only (no Babel, no polyfills), so anything
            // these rules suggest ships verbatim to Joplin's mobile WebView.
            // Joplin's Android floor is API 24, where the system WebView may
            // predate all of the below. Keep tsconfig `target` at es2020 in
            // sync with this list.
            'unicorn/prefer-at': 'off', // Array#at — ES2022 / Chrome 92 / iOS 15.4
            'unicorn/prefer-string-replace-all': 'off', // String#replaceAll — ES2021
            'unicorn/prefer-dom-node-replace-children': 'off', // replaceChildren — Chrome 86 / Safari 14
            'unicorn/prefer-promise-with-resolvers': 'off', // Promise.withResolvers — ES2024

            // Group 2: rules whose output we judged worse than the code it
            // replaces, or pure churn. Not compatibility-related — revisit
            // freely if the trade-off reads differently later.
            //
            // Rewrites `[a[i], a[j]] = [a[j], a[i]]` into a 3-line temp swap.
            'unicorn/no-unreadable-array-destructuring': 'off',
            // Rewrites the literal '   ' into ' '.repeat(3) in test fixtures.
            'unicorn/prefer-string-repeat': 'off',
            // Converts short if/else-if chains to switch; the autofix leaves
            // stray blank lines and `// No default` markers behind.
            'unicorn/prefer-switch': 'off',
            // `return undefined` is the clearer form where undefined is a
            // meaningful sentinel that callers branch on.
            'unicorn/no-useless-undefined': 'off',
            // appendChild -> append across ~66 call sites: safe, but no
            // behavioural or readability gain for the diff it costs.
            'unicorn/prefer-dom-node-append': 'off',
            // Flags addEventListener(..., true) but not the matching
            // removeEventListener, so enabling it guarantees asymmetry.
            'unicorn/prefer-add-event-listener-options': 'off',
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
