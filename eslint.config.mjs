// Flat config (ESM). Adds ignores, Node + Vitest globals, and TS-friendly rule tweaks.

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import tsdoc from 'eslint-plugin-tsdoc';
import importPlugin from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import prettier from 'eslint-config-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import vitest from '@vitest/eslint-plugin';

const CONTENT_SCRIPT_DIR = 'src/contentScript';

/**
 * Content-script layer dependencies: each layer lists the sibling folders it may import from; every
 * other layer folder is forbidden. Enforced by import-x/no-restricted-paths on resolved file paths,
 * so it applies at any nesting depth and regardless of how the import specifier is written.
 *
 * The composition root (`contentScript/tableWidgetExtension.ts`) sits directly under
 * `contentScript/`, outside every layer zone, so it may wire all layers together.
 */
const LAYER_DEPENDENCIES = {
    shared: {
        allowed: [],
        message: 'shared must stay feature-agnostic.',
    },
    services: {
        allowed: ['shared'],
        message: 'services may depend only on shared utilities and external integration code.',
    },
    tableModel: {
        allowed: ['shared'],
        message: 'tableModel must not depend on higher-level editor layers.',
    },
    tableState: {
        allowed: ['shared', 'tableModel'],
        message: 'tableState is limited to model types, shared helpers, and sibling state modules.',
    },
    nestedEditor: {
        allowed: ['shared', 'services', 'tableModel', 'tableState'],
        message:
            'nestedEditor must not depend on runtime orchestration, widget rendering, command entry points, or toolbar UI; tableRuntime injects table interaction policy.',
    },
    tableWidget: {
        allowed: ['shared', 'services', 'tableModel', 'tableState', 'nestedEditor'],
        message:
            'tableWidget owns rendering and DOM reading; event handling and editor orchestration belong in tableRuntime.',
    },
    tableRuntime: {
        allowed: ['shared', 'services', 'tableModel', 'tableState', 'tableWidget', 'nestedEditor'],
        message: 'tableRuntime must stay below toolbar UI and command entry points in the dependency graph.',
    },
    toolbar: {
        allowed: ['shared', 'services', 'tableModel', 'tableState', 'tableWidget', 'tableRuntime'],
        message:
            'toolbar actions should go through state/runtime APIs instead of nested-editor internals or command entry points.',
    },
    tableCommands: {
        allowed: ['shared', 'tableModel', 'tableState', 'tableRuntime'],
        message:
            'tableCommands should go through state/runtime APIs instead of widget, nested-editor, or toolbar internals.',
    },
};

const LAYERS = Object.keys(LAYER_DEPENDENCIES);

const LAYER_ZONES = Object.entries(LAYER_DEPENDENCIES).map(([layer, { allowed, message }]) => ({
    target: `${CONTENT_SCRIPT_DIR}/${layer}`,
    from: LAYERS.filter((folder) => folder !== layer && !allowed.includes(folder)).map(
        (folder) => `${CONTENT_SCRIPT_DIR}/${folder}`
    ),
    message,
}));

const EDITOR_RUNTIME_PACKAGES = ['@codemirror/view', '@codemirror/state', '@codemirror/language'];

export default defineConfig([
    {
        // webpack.config.js is generator-managed scaffold (overwritten on generator updates).
        ignores: ['api/**', 'dist/**', 'coverage/**', 'webpack.config.js'],
    },

    js.configs.recommended,
    // Curated sonarjs subset: the recommended preset is dominated by irrelevant (AWS, SQL, cookie) and stylistic rules.
    {
        plugins: { sonarjs },
        rules: {
            // Maintainability and suspicious control flow
            'sonarjs/cognitive-complexity': 'error',
            'sonarjs/no-identical-functions': 'error',
            'sonarjs/no-invariant-returns': 'error',
            'sonarjs/no-all-duplicated-branches': 'error',
            'sonarjs/no-duplicated-branches': 'error',
            'sonarjs/no-identical-expressions': 'error',
            'sonarjs/no-gratuitous-expressions': 'error',
            'sonarjs/no-unthrown-error': 'error',
            'sonarjs/updated-loop-counter': 'error',
            'sonarjs/no-useless-increment': 'error',
            'sonarjs/no-nested-assignment': 'error',

            // Readability
            'sonarjs/no-nested-conditional': 'error',
            'sonarjs/prefer-single-boolean-return': 'error',
            'sonarjs/no-redundant-boolean': 'error',
            'sonarjs/no-inverted-boolean-check': 'error',

            // Assignments and ignored results
            'sonarjs/no-dead-store': 'error',
            'sonarjs/no-redundant-assignments': 'error',
            'sonarjs/no-ignored-return': 'error',

            // Collections: relevant to table transformations and state
            'sonarjs/no-collection-size-mischeck': 'error',
            'sonarjs/no-empty-collection': 'error',
            'sonarjs/no-unused-collection': 'error',
            'sonarjs/no-element-overwrite': 'error',
            'sonarjs/no-misleading-array-reverse': 'error',
            'sonarjs/no-alphabetical-sort': 'error',
            'sonarjs/reduce-initial-value': 'error',

            // Sanitizing rendered Markdown
            'sonarjs/dompurify-unsafe-config': 'error',

            // Regex correctness and performance (core no-misleading-character-class is already enabled)
            'sonarjs/slow-regex': 'error',
            'sonarjs/super-linear-regex': 'error',
            'sonarjs/stateful-regex': 'error',
            'sonarjs/anchor-precedence': 'error',
            'sonarjs/duplicates-in-character-class': 'error',
            'sonarjs/no-empty-alternatives': 'error',
            'sonarjs/unused-named-groups': 'error',
        },
    },
    // Registers the TS parser/plugin, disables core rules TypeScript already checks, enables recommended rules.
    tseslint.configs.recommendedTypeChecked,

    // Project TS/JS sources
    {
        files: ['**/*.{ts,tsx,js,mts}'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            'import-x': importPlugin,
            tsdoc,
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
            // Allow underscore-prefixed unused variables (common convention for intentionally unused params)
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // report an error if any circular dependency is found
            'import-x/no-cycle': ['error', { maxDepth: Infinity }],
            'import-x/no-restricted-paths': ['error', { basePath: import.meta.dirname, zones: LAYER_ZONES }],
            'import-x/no-self-import': 'error',
            // Merge duplicate imports using inline `type` specifiers, matching consistent-type-imports below
            'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            // Use `import type { A }` rather than `import { type A }` when every specifier is a type
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/no-inferrable-types': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/no-deprecated': 'error',
            // Log through src/logger.ts, which owns the console calls (exempted below).
            'no-console': 'error',
            'tsdoc/syntax': 'error',
        },
    },

    // The logger wrapper is the one place allowed to write to the console.
    {
        files: ['src/logger.ts'],
        rules: {
            'no-console': 'off',
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

    // Root JS config files (e.g. .prettierrc.js, eslint.config.mjs) aren't part of the typed source; lint them untyped.
    {
        files: ['**/*.{js,mjs,cjs}'],
        ...tseslint.configs.disableTypeChecked,
    },

    // Prettier compatibility
    prettier,
]);
