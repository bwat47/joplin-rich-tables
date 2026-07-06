import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/**/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
        passWithNoTests: true,
    },
    resolve: {
        alias: {
            dompurify: path.resolve(__dirname, '__mocks__/dompurify.ts'),
            '@joplin/fork-uslug': path.resolve(__dirname, '__mocks__/@joplin/fork-uslug.ts'),
            api: path.resolve(__dirname, 'api/index.ts'),
        },
    },
});
