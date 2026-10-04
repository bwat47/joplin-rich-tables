// Flat config (ESM). Adds ignores, Node + Vitest globals, and TS-friendly rule tweaks.

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import vitest from '@vitest/eslint-plugin';

const CONTENT_SCRIPT_DIR = 'src/contentScript';

/**
 * Content-script layer boundaries: files anywhere under `layer` must not import from the
 * `forbidden` sibling folders. Enforced by import/no-restricted-paths on resolved file paths,
 * so it applies at any nesting depth and regardless of how the import specifier is written.
 */
const LAYER_BOUNDARIES = [
    {
        layer: 'shared',
        forbidden: [
            'tableModel',
            'tableState',
            'tableRuntime',
            'tableWidget',
            'tableCommands',
            'nestedEditor',
            'services',
            'toolbar',
        ],
        message: 'shared must stay feature-agnostic.',
    },
    {
        layer: 'services',
        forbidden: [
            'tableModel',
            'tableState',
            'tableRuntime',
            'tableWidget',
            'tableCommands',
            'nestedEditor',
            'toolbar',
        ],
        message: 'services may depend only on shared utilities and external integration code.',
    },
    {
        layer: 'tableModel',
        forbidden: [
            'tableState',
            'tableRuntime',
            'tableWidget',
            'tableCommands',
            'nestedEditor',
            'services',
            'toolbar',
        ],
        message: 'tableModel must not depend on higher-level editor layers.',
    },
    {
        layer: 'tableState',
        forbidden: ['tableRuntime', 'tableWidget', 'tableCommands', 'nestedEditor', 'services', 'toolbar'],
        message: 'tableState is limited to model types, shared helpers, and sibling state modules.',
    },
    {
        layer: 'tableRuntime',
        forbidden: ['tableCommands'],
        message: 'tableRuntime must stay below tableCommands in the dependency graph.',
    },
    {
        layer: 'tableCommands',
        forbidden: ['tableWidget', 'nestedEditor', 'services'],
        message: 'tableCommands should go through state/runtime APIs instead of widget or nested-editor internals.',
    },
    {
        layer: 'tableWidget',
        forbidden: ['tableCommands'],
        message: 'tableWidget modules must not depend on command registration or command entry points.',
    },
];

const LAYER_ZONES = LAYER_BOUNDARIES.map(({ layer, forbidden, message }) => ({
    target: `${CONTENT_SCRIPT_DIR}/${layer}`,
    from: forbidden.map((folder) => `${CONTENT_SCRIPT_DIR}/${folder}`),
    message,
}));

const EDITOR_RUNTIME_PACKAGES = ['@codemirror/view', '@codemirror/state', '@codemirror/language'];

export default [
    {
        // webpack.config.js is generator-managed scaffold (overwritten on generator updates).
        ignores: ['api/**', 'dist/**', 'coverage/**', 'webpack.config.js'],
    },

    js.configs.recommended,
    sonarjs.configs.recommended,

    // Project TS/JS sources
    {
        files: ['**/*.{ts,tsx,js}'],
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2020,
            sourceType: 'module',
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            import: importPlugin,
        },
        settings: {
            // Without these, import-x silently skips TS imports and rules like no-cycle never fire.
            // Resolve imports the way tsc does (.ts extensions, tsconfig paths)...
            'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
            // ...and parse resolved .ts files when following the import graph.
            'import-x/extensions': ['.ts', '.tsx', '.js'],
            'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
        },
        rules: {
            // Turn off rules TypeScript handles (prevents NodeJS / type-only false positives)
            'no-undef': 'off',
            ...tsPlugin.configs['recommended-type-checked'].rules,
            // Allow underscore-prefixed unused variables (common convention for intentionally unused params)
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // report an error if any circular dependency is found
            'import/no-cycle': ['error', { maxDepth: Infinity }],
            'import/no-restricted-paths': ['error', { basePath: import.meta.dirname, zones: LAYER_ZONES }],
            'no-useless-escape': 'off',
            'sonarjs/dompurify-unsafe-config': 'off',
            '@typescript-eslint/no-inferrable-types': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
        },
    },

    // tableModel is pure data logic: no editor/runtime packages either.
    {
        files: [`${CONTENT_SCRIPT_DIR}/tableModel/**/*.ts`],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: EDITOR_RUNTIME_PACKAGES.map((name) => ({
                        name,
                        message: 'tableModel must not depend on editor/runtime packages.',
                    })),
                },
            ],
        },
    },

    // Composition root: wires every layer together, so it is exempt from layer boundaries.
    {
        files: [`${CONTENT_SCRIPT_DIR}/tableWidget/tableWidgetExtension.ts`],
        rules: {
            'import/no-restricted-paths': 'off',
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
        plugins: {
            vitest,
        },
        rules: {
            ...vitest.configs.recommended.rules,
            // The Vitest-aware variant allows method references passed to expect() and vi.mocked().
            '@typescript-eslint/unbound-method': 'off',
            'vitest/unbound-method': 'error',
            // Assertions often live in expect*() helpers.
            'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*'] }],
            // Async stubs may resolve immediately.
            '@typescript-eslint/require-await': 'off',
            // Vitest asymmetric matchers are typed as any.
            '@typescript-eslint/no-unsafe-assignment': 'off',
        },
    },

    // Vitest 5 benchmarks use test() to measure workloads without correctness assertions.
    {
        files: ['**/*.bench.ts'],
        rules: {
            'sonarjs/assertions-in-tests': 'off',
        },
    },

    // Per-platform shortcut entry points. Each one only installs a navigator stub and
    // calls the shared harness, which registers every case; the rule sees no literal `it`.
    {
        files: ['src/contentScript/__tests__/platformShortcuts.*.test.ts'],
        rules: {
            'sonarjs/no-empty-test-file': 'off',
        },
    },

    // Root JS config files (e.g. .prettierrc.js) aren't part of the typed source; lint them untyped.
    {
        files: ['**/*.js'],
        ...tsPlugin.configs['flat/disable-type-checked'],
    },

    // Prettier compatibility
    prettier,
];
