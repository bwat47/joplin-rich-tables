import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readProject } from './packagePlugin.mjs';

/** Matches a `major.minor.patch` version, e.g. `1.14.2`. */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Returns the text of a hand-formatted JSON file with its single `"version": "<from>"` entry
 * replaced, leaving every other byte untouched so a version bump produces a one-line diff.
 */
async function replaceVersion(filePath, from, to) {
    const text = await readFile(filePath, 'utf8');
    // e.g. `"version": "1.14.2"`; `from` is validated semver, so only its dots need escaping.
    const pattern = new RegExp(`("version"\\s*:\\s*")${from.replaceAll('.', '\\.')}(")`, 'g');
    const matches = text.match(pattern)?.length ?? 0;
    if (matches !== 1) {
        throw new Error(`Expected one "version": "${from}" entry in ${filePath}, found ${matches}.`);
    }
    return text.replace(pattern, `$1${to}$2`);
}

export async function updateVersion(root) {
    const { packageJson } = await readProject(root);
    const current = packageJson.version;
    if (!SEMVER_PATTERN.test(current)) {
        throw new Error('updateVersion requires a version in major.minor.patch format.');
    }
    const [major, minor, patch] = current.split('.').map(Number);
    const version = `${major}.${minor}.${patch + 1}`;

    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    const lockRoot = lock.packages?.[''];
    if (!lockRoot) {
        throw new Error(`${lockPath} has no root package entry (packages[""]); regenerate it with npm install.`);
    }
    if (lock.version !== current || lockRoot.version !== current) {
        throw new Error(
            `${lockPath} versions (${lock.version}, ${lockRoot.version}) do not match package.json (${current}); ` +
                'run npm install to resync the lockfile.'
        );
    }
    lock.version = version;
    lockRoot.version = version;

    const packagePath = path.join(root, 'package.json');
    const manifestPath = path.join(root, 'src/manifest.json');
    // Prepare every file before writing any, so a failed check leaves all versions in sync.
    const updates = [
        [packagePath, await replaceVersion(packagePath, current, version)],
        [manifestPath, await replaceVersion(manifestPath, current, version)],
        // npm owns the lockfile format, which is JSON.stringify output; dependencies may share the version string.
        [lockPath, `${JSON.stringify(lock, null, 4)}\n`],
    ];
    for (const [filePath, text] of updates) await writeFile(filePath, text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await updateVersion(fileURLToPath(new URL('../', import.meta.url)));
}
