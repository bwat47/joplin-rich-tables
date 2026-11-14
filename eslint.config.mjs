// Flat config (ESM). Adds ignores, Node + Vitest globals, and TS-friendly rule tweaks.

import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importPlugin from 'eslint-plugin-import-x';
import sonarjs from 'eslint-plugin-sonarjs';
import tsdoc from 'eslint-plugin-tsdoc';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CONTENT_SCRIPT_DIR = 'src/contentScript';
const SOURCE_FILE_GLOB = '**/*.{ts,tsx,js,mts}';

const EDITOR_RUNTIME_PACKAGES = ['@codemirror/view', '@codemirror/state', '@codemirror/language'];

export default defineConfig([
    {
        // .api-staging-* is left behind only if `npm run updateApi` is interrupted.
        ignores: ['api/**', '.api-staging-*/**', 'dist/**', 'coverage/**'],
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
            'sonarjs/no-collapsible-if': 'error',

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
        files: [SOURCE_FILE_GLOB],
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
        },
        rules: {
            // Allow underscore-prefixed unused variables (common convention for intentionally unused params)
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // report an error if any circular dependency is found
            'import-x/no-cycle': ['error', { maxDepth: Infinity }],
            'import-x/no-self-import': 'error',
            // Merge duplicate imports using inline `type` specifiers, matching consistent-type-imports below
            'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
            '@typescript-eslint/consistent-type-exports': ['error', { fixMixedExportsWithInlineTypeSpecifier: true }],
            // Use `import type { A }` rather than `import { type A }` when every specifier is a type
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/no-inferrable-types': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/no-deprecated': 'error',
            eqeqeq: ['error', 'always'],
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

    // JS config files are linted without TypeScript's type checker.
    {
        files: ['**/*.{js,mjs,cjs}'],
        ...tseslint.configs.disableTypeChecked,
        languageOptions: { globals: globals.node },
    },

    // Prettier compatibility
    prettier,
]);
