import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Matches TypeScript sources, which are bundled rather than copied,
 * e.g. `index.ts`, `view.tsx`, `worker.mts`, `config.cts`, `types.d.ts` (not `notes.txt`).
 */
export const TYPESCRIPT_SOURCE_PATTERN = /\.(?:[cm]?ts|tsx)$/;

/** Matches a bundleable script extension, e.g. `a.ts`, `a.tsx`, `a.js`, `a.jsx` (not `a.json`, `a.css`). */
const SCRIPT_EXTENSION_PATTERN = /\.[jt]sx?$/;

/** Splits a path on either separator, e.g. `a/b\c` becomes `['a', 'b', 'c']`. */
const PATH_SEPARATOR_PATTERN = /[\\/]/;

// Keep the generator's explicit host-library list: these must share Joplin's instances.
// `npm run updateApi` warns when this list differs from the generator's.
export const contentScriptExternals = [
    '@codemirror/view',
    '@codemirror/state',
    '@codemirror/search',
    '@codemirror/language',
    '@codemirror/autocomplete',
    '@codemirror/commands',
    '@codemirror/highlight',
    '@codemirror/lint',
    '@codemirror/lang-html',
    '@codemirror/lang-markdown',
    '@codemirror/language-data',
    '@lezer/common',
    '@lezer/markdown',
    '@lezer/highlight',
];

/**
 * Options shared by the main plugin and content-script bundles.
 * `api` resolves through tsconfig.json `paths`: api/index.ts exports Joplin's injected global,
 * and api/types contains runtime enums, so both are bundled.
 */
const sharedOptions = {
    absWorkingDir: root,
    bundle: true,
    format: 'cjs',
    target: 'es2020',
    minify: true,
    // Matches Webpack's production mode. esbuild only sets this automatically for minified browser builds,
    // and the main bundle may run in a webview without `process` (mobile).
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
export const buildOptions = {
    ...sharedOptions,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    platform: 'node',
};

/**
 * Reads the `extraScripts` list (paths relative to `src/`) from `<root>/plugin.config.json`.
 * @returns {Promise<string[]>}
 */
export async function readExtraScripts(root) {
    const configPath = path.join(root, 'plugin.config.json');
    let config;
    try {
        config = JSON.parse(await readFile(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not read ${configPath}: ${error.message}`, { cause: error });
    }
    const { extraScripts } = config;
    if (!Array.isArray(extraScripts) || extraScripts.some((script) => typeof script !== 'string')) {
        throw new Error(`${configPath} must define "extraScripts" as an array of paths relative to src/.`);
    }
    return extraScripts;
}

/** @returns {import('esbuild').BuildOptions} */
export function contentScriptBuildOptions(script) {
    if (
        !SCRIPT_EXTENSION_PATTERN.test(script) ||
        path.isAbsolute(script) ||
        script.split(PATH_SEPARATOR_PATTERN).includes('..')
    ) {
        throw new Error(`Invalid extra script path: ${script}`);
    }
    // Content scripts run in the editor webview, so they use esbuild's default browser platform:
    // a Node built-in import fails the build instead of becoming a runtime require.
    return {
        ...sharedOptions,
        entryPoints: [`src/${script}`],
        outfile: `dist/${script.replace(SCRIPT_EXTENSION_PATTERN, '.js')}`,
        external: contentScriptExternals,
    };
}
