import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from 'tar';

import { contentScriptExternals } from './buildConfig.mjs';
import { VALID_CATEGORIES } from './packagePlugin.mjs';

const templates = 'package/generators/app/templates';

/**
 * Matches the generator's category list, e.g.
 * `const allPossibleCategories = [{'name':'appearance'},{'name':'editor'}];`
 */
const GENERATOR_CATEGORIES_PATTERN = /const allPossibleCategories = \[(.*?)\];/s;

/** Matches one category entry within that list, e.g. `{'name':'developer tools'}` captures `developer tools`. */
const GENERATOR_CATEGORY_NAME_PATTERN = /["']name["']\s*:\s*["']([^"']+)["']/g;

/**
 * Matches the generator's content-script externals, e.g.
 * `const externalContentScriptLibraries = [\n\t'@codemirror/view',\n\t'@lezer/common',\n];`
 */
const GENERATOR_EXTERNALS_PATTERN = /const externalContentScriptLibraries = \[([^\]]*)\]/;

/** Matches one quoted string, e.g. `'@codemirror/view'` captures `@codemirror/view`. */
const QUOTED_STRING_PATTERN = /["']([^"']+)["']/g;

/**
 * Runs npm with fixed arguments. Under `npm run`, npm_execpath points at npm's CLI script,
 * which avoids spawning npm.cmd through a shell on Windows.
 */
function npm(args, cwd) {
    const npmCli = process.env.npm_execpath;
    if (npmCli?.endsWith('.js')) {
        execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'pipe' });
    } else if (process.platform === 'win32') {
        throw new Error('Run this script with: npm run updateApi');
    } else {
        execFileSync('npm', args, { cwd, stdio: 'pipe' });
    }
}

function extractList(text, listPattern, itemPattern) {
    const list = listPattern.exec(text)?.[1];
    return list === undefined ? undefined : [...list.matchAll(itemPattern)].map((match) => match[1]);
}

function describeListDifference(label, generatorItems, localItems, location) {
    if (generatorItems === undefined) {
        return `Could not find the ${label} in generator-joplin's webpack.config.js; compare ${location} manually.`;
    }
    const local = new Set(localItems);
    const generator = new Set(generatorItems);
    const missing = [...generator].filter((item) => !local.has(item));
    const extra = [...local].filter((item) => !generator.has(item));
    if (missing.length === 0 && extra.length === 0) return undefined;
    const details = [
        missing.length > 0 ? `missing ${missing.join(', ')}` : '',
        extra.length > 0 ? `not in generator ${extra.join(', ')}` : '',
    ].filter(Boolean);
    return `The ${label} differ from generator-joplin (${details.join('; ')}); update ${location}.`;
}

/**
 * Compares the hand-maintained category and content-script external lists with the ones in
 * generator-joplin's `webpack.config.js` text. Returns one warning per list that differs or
 * cannot be found; an empty array means both match.
 * @returns {string[]}
 */
export function compareGeneratorLists(webpackConfig) {
    return [
        describeListDifference(
            'plugin categories',
            extractList(webpackConfig, GENERATOR_CATEGORIES_PATTERN, GENERATOR_CATEGORY_NAME_PATTERN),
            VALID_CATEGORIES,
            'VALID_CATEGORIES in scripts/packagePlugin.mjs'
        ),
        describeListDifference(
            'content-script externals',
            extractList(webpackConfig, GENERATOR_EXTERNALS_PATTERN, QUOTED_STRING_PATTERN),
            contentScriptExternals,
            'contentScriptExternals in scripts/buildConfig.mjs'
        ),
    ].filter((warning) => warning !== undefined);
}

/**
 * Replaces `<root>/api` with a copy of `source`. The copy is staged next to `api/` and swapped in
 * by rename, so a failed copy leaves the existing `api/` untouched. `copy` defaults to a recursive copy.
 */
export async function replaceApi(root, source, copy = (from, to) => cp(from, to, { recursive: true })) {
    // Fail before changing anything if the generator layout has changed.
    await stat(path.join(source, 'index.ts'));
    const destination = path.join(root, 'api');
    const staging = await mkdtemp(path.join(root, '.api-staging-'));
    const backup = `${staging}-previous`;
    try {
        await copy(source, staging);
        let hadPrevious = true;
        try {
            await rename(destination, backup);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            hadPrevious = false;
        }
        try {
            await rename(staging, destination);
        } catch (error) {
            if (hadPrevious) await rename(backup, destination);
            throw error;
        }
        if (hadPrevious) await rm(backup, { recursive: true, force: true });
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}

async function readGeneratorWarnings(webpackConfigPath) {
    let webpackConfig;
    try {
        webpackConfig = await readFile(webpackConfigPath, 'utf8');
    } catch (error) {
        return [`Could not read ${webpackConfigPath} (${error.message}); compare the build lists manually.`];
    }
    return compareGeneratorLists(webpackConfig);
}

/**
 * Replaces `<root>/api` with the API declarations from the latest generator-joplin package.
 * Nothing else in the project is touched. Returns the generator version used and warnings for
 * hand-maintained build lists that no longer match the generator.
 * @returns {Promise<{ version: string, warnings: string[] }>}
 */
export async function updateApi(root, packageSpec = 'generator-joplin@latest') {
    const temp = await mkdtemp(path.join(tmpdir(), 'joplin-api-'));
    try {
        npm(['pack', packageSpec, '--pack-destination', temp], temp);
        // The --json output shape differs between npm versions, so locate the tarball instead.
        const tarball = (await readdir(temp)).find((name) => name.endsWith('.tgz'));
        if (!tarball) throw new Error(`npm pack did not produce a tarball for ${packageSpec}`);
        await extract({ file: path.join(temp, tarball), cwd: temp, strict: true });
        const { version } = JSON.parse(await readFile(path.join(temp, 'package/package.json'), 'utf8'));
        await replaceApi(root, path.join(temp, templates, 'api'));
        const warnings = await readGeneratorWarnings(path.join(temp, templates, 'webpack.config.js'));
        return { version, warnings };
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { version, warnings } = await updateApi(fileURLToPath(new URL('../', import.meta.url)));
    console.info(`Updated api/ from generator-joplin ${version}. Review with: git diff api/`);
    for (const warning of warnings) console.warn(`WARNING: ${warning}`);
}
