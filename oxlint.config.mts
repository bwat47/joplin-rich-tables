import regexp from 'eslint-plugin-regexp';
import { defineConfig } from 'oxlint';

const CONTENT_SCRIPT_DIR = 'src/contentScript';
const REGEXP_RULE_PREFIX = 'regexp/';
const EDITOR_RUNTIME_PACKAGES = ['@codemirror/view', '@codemirror/state', '@codemirror/language'];

/**
 * The plugin's own rules from its recommended preset. The preset also reconfigures
 * core rules (e.g. `no-invalid-regexp`), which oxlint's categories already cover.
 */
const regexpRecommendedRules = Object.fromEntries(
    Object.entries(regexp.configs['flat/recommended'].rules).filter(([name]) => name.startsWith(REGEXP_RULE_PREFIX))
);

// Layer boundaries and complexity limits are enforced by fallow (`.fallowrc.json`, `npm run lint:boundaries`/`lint:complexity`).
export default defineConfig({
    plugins: ['eslint', 'typescript', 'import', 'vitest', 'unicorn', 'oxc'],
    jsPlugins: ['eslint-plugin-regexp'],
    categories: {
        correctness: 'error',
        suspicious: 'error',
    },
    options: {
        typeAware: true,
    },
    env: {
        node: true,
    },
    // .api-staging-* is left behind only if `npm run updateApi` is interrupted.
    ignorePatterns: ['api/**', '.api-staging-*/**', 'dist/**', 'coverage/**'],
    rules: {
        eqeqeq: ['error', 'always'],
        // Allow underscore-prefixed unused variables (common convention for intentionally unused params)
        'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        // Log through src/logger.ts, which owns the console calls (exempted below).
        'no-console': 'error',

        // Import graph
        'import/no-cycle': 'error',
        'import/no-self-import': 'error',
        // Merge duplicate imports using inline `type` specifiers, matching consistent-type-imports below
        'import/no-duplicates': ['error', { preferInline: true }],

        // Suspicious control flow (formerly a curated sonarjs subset). Complexity limits live in fallow.
        'no-useless-assignment': 'error',
        'no-self-compare': 'error',
        'no-multi-assign': 'error',
        'no-nested-ternary': 'error',
        'no-unneeded-ternary': 'error',
        'unicorn/no-lonely-if': 'error',
        'unicorn/no-negation-in-equality-check': 'error',

        // Suspicious-category rules that do not fit this codebase
        // toSorted()/toReversed() are ES2023; the build targets ES2020.
        'unicorn/no-array-sort': 'off',
        'unicorn/no-array-reverse': 'off',
        // Typed `new Array<T>(n).fill(x)` and preallocated arrays are intentional.
        'unicorn/no-new-array': 'off',
        // Flags exhaustive switches; tsc already checks every path returns the declared type.
        'typescript/consistent-return': 'off',
        // Assertions on DOM and CodeMirror values are routine and checked by tests.
        'typescript/no-unsafe-type-assertion': 'off',

        // Regex correctness and performance
        ...regexpRecommendedRules,
        // The `i` flag applies to the whole pattern; keep explicit case ranges in allowlists.
        'regexp/use-ignore-case': 'off',
    },
    overrides: [
        {
            files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
            rules: {
                // typescript-eslint recommendedTypeChecked rules outside the enabled categories
                'typescript/ban-ts-comment': 'error',
                'typescript/no-empty-object-type': 'error',
                'typescript/no-explicit-any': 'error',
                'typescript/no-misused-promises': 'error',
                'typescript/no-namespace': 'error',
                'typescript/no-require-imports': 'error',
                'typescript/no-unsafe-argument': 'error',
                'typescript/no-unsafe-assignment': 'error',
                'typescript/no-unsafe-call': 'error',
                'typescript/no-unsafe-function-type': 'error',
                'typescript/no-unsafe-member-access': 'error',
                'typescript/no-unsafe-return': 'error',
                'typescript/only-throw-error': 'error',
                'typescript/prefer-promise-reject-errors': 'error',
                'typescript/require-await': 'error',
                'typescript/restrict-plus-operands': 'error',

                // Project additions
                'typescript/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
                'typescript/consistent-type-exports': ['error', { fixMixedExportsWithInlineTypeSpecifier: true }],
                // Use `import type { A }` rather than `import { type A }` when every specifier is a type
                'typescript/no-import-type-side-effects': 'error',
                'typescript/no-inferrable-types': 'error',
                'typescript/no-unnecessary-condition': 'error',
                'typescript/explicit-module-boundary-types': 'error',
                'typescript/switch-exhaustiveness-check': 'error',
                'typescript/no-deprecated': 'error',
                'typescript/require-array-sort-compare': 'error',
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
                '**/__benchmarks__/**/*.ts',
                'src/testHelpers.ts',
            ],
            env: {
                vitest: true,
            },
            rules: {
                'vitest/require-mock-type-parameters': 'off',
                // Fixture-driven suites name describe blocks from typed labels.
                'vitest/valid-title': ['error', { ignoreTypeOfDescribeName: true }],
                // Test helpers are kept next to the suites that use them.
                'unicorn/consistent-function-scoping': 'off',
                // Split literals keep escapes and fixture boundaries readable.
                'no-useless-concat': 'off',
                // Platform stubs are side-effect imports that must load before CodeMirror.
                'import/no-unassigned-import': 'off',
                // Method references passed to expect() and vi.mocked() are not unbound calls.
                'typescript/unbound-method': 'off',
                // Assertions often live in expect*() helpers.
                'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*'] }],
                'vitest/no-identical-title': 'error',
                'vitest/no-import-node-test': 'error',
                // Async stubs may resolve immediately.
                'typescript/require-await': 'off',
                // Vitest asymmetric matchers are typed as any.
                'typescript/no-unsafe-assignment': 'off',
            },
        },
    ],
});
