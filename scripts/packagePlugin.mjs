import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { create } from 'tar';

/**
 * Plugin repository categories accepted in `manifest.categories`.
 * Mirrors generator-joplin's list; `npm run updateApi` warns when they differ.
 */
export const VALID_CATEGORIES = new Set([
    'appearance',
    'developer tools',
    'productivity',
    'themes',
    'integrations',
    'viewer',
    'search',
    'tags',
    'editor',
    'files',
    'personal knowledge management',
]);

/** File extensions accepted for local manifest screenshots. */
const SCREENSHOT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/** Maximum size of a local manifest screenshot. */
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

/** Matches a remote screenshot URL, which is not validated locally, e.g. `https://example.com/a.png`. */
const REMOTE_URL_PATTERN = /^https?:\/\//;

/** Matches a valid plugin ID, e.g. `com.bwat47.rich-tables` (letters, digits, `_`, `.`, `-`). */
const PLUGIN_ID_PATTERN = /^[\w.-]+$/;

export async function readProject(root) {
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
    if (!manifest.id || !PLUGIN_ID_PATTERN.test(manifest.id)) {
        throw new Error('Manifest plugin ID must contain only letters, digits, underscores, dots, or hyphens.');
    }
    if (manifest.version !== packageJson.version) {
        throw new Error('package.json and src/manifest.json versions must match.');
    }
    if (!packageJson.name?.startsWith('joplin-plugin-') || !packageJson.keywords?.includes('joplin-plugin')) {
        throw new Error('Package name must start with joplin-plugin- and keywords must include joplin-plugin.');
    }
    const selectedCategories = manifest.categories ?? [];
    if (
        new Set(selectedCategories).size !== selectedCategories.length ||
        selectedCategories.some((category) => !VALID_CATEGORIES.has(category))
    ) {
        throw new Error('Manifest contains invalid or repeated categories.');
    }
    for (const screenshot of manifest.screenshots ?? []) {
        if (!screenshot.src) throw new Error('Manifest screenshot must specify src.');
        if (REMOTE_URL_PATTERN.test(screenshot.src)) continue;
        if (!SCREENSHOT_EXTENSIONS.has(path.extname(screenshot.src))) {
            throw new Error(`Unsupported screenshot type: ${screenshot.src}`);
        }
        if ((await stat(path.join(root, screenshot.src))).size > MAX_SCREENSHOT_BYTES) {
            throw new Error(`Screenshot exceeds ${MAX_SCREENSHOT_BYTES / (1024 * 1024)} MB: ${screenshot.src}`);
        }
    }
    return { packageJson, manifest };
}

/** Branch recorded in `_publish_commit` when the build runs from a detached HEAD. */
const DEFAULT_BRANCH = 'main';

function currentGitInfo(root) {
    try {
        // Git is intentionally resolved from the developer's PATH, with fixed arguments and no shell.
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, stdio: 'pipe' })
            .toString()
            .trim();
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: 'pipe' }).toString().trim();
        // A detached HEAD (e.g. a CI tag checkout) reports `HEAD`; record the default branch instead.
        return `${branch === 'HEAD' ? DEFAULT_BRANCH : branch}:${commit}`;
    } catch {
        return '';
    }
}

/** Lists files under `directory`, skipping dotfiles and dot-directories (e.g. `.DS_Store`, `.gitkeep`). */
async function listFiles(directory, prefix = '') {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const relativePath = `${prefix}${entry.name}`;
        if (entry.isDirectory()) {
            files.push(...(await listFiles(path.join(directory, entry.name), `${relativePath}/`)));
        } else {
            files.push(relativePath);
        }
    }
    return files.sort();
}

export async function packagePlugin(root, manifest, extraScripts = []) {
    const dist = path.join(root, 'dist');
    const publish = path.join(root, 'publish');
    // Require the entry point and manifest, rather than publishing an incomplete build.
    await stat(path.join(dist, 'index.js'));
    await stat(path.join(dist, 'manifest.json'));
    for (const script of extraScripts) await stat(path.join(dist, script));
    await mkdir(publish, { recursive: true });
    const archivePath = path.join(publish, `${manifest.id}.jpl`);
    // Package files only, matching the generator and excluding empty source directories.
    await create({ cwd: dist, file: archivePath, portable: true, strict: true }, await listFiles(dist));
    const hash = createHash('sha256')
        .update(await readFile(archivePath))
        .digest('hex');
    const info = { ...manifest, _publish_hash: `sha256:${hash}`, _publish_commit: currentGitInfo(root) };
    await writeFile(path.join(publish, `${manifest.id}.json`), `${JSON.stringify(info, null, 4)}\n`);
}
