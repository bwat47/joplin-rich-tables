import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
        passWithNoTests: true,
        // History-shortcut tests stub `navigator` before `@codemirror/view` evaluates its
        // platform snapshot. Inlining the family keeps one copy of those modules per test file.
        server: {
            deps: {
                inline: [/^@codemirror\//],
            },
        },
    },
    resolve: {
        alias: {
            '@joplin/fork-uslug': path.resolve(import.meta.dirname, '__mocks__/@joplin/fork-uslug.ts'),
            api: path.resolve(import.meta.dirname, 'api/index.ts'),
        },
    },
});
