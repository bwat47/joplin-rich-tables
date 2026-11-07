import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
    contentScriptExternals,
    createBuildOptions,
    createContentScriptBuildOptions,
} from '@bwat47/joplin-plugin-scripts';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));

test('the content-script bundle exports a factory and shares host CodeMirror instances', async (t) => {
    const result = await build({
        ...createContentScriptBuildOptions(root, 'contentScript/tableWidgetExtension.ts'),
        write: false,
        metafile: true,
        logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(!inputs.some((input) => /node_modules\/@(?:codemirror|lezer)\//.test(input)));
    assert.ok(inputs.some((input) => input.includes('node_modules/@floating-ui/dom/')));
    assert.ok(inputs.some((input) => input.includes('node_modules/dompurify/')));
    const imports = Object.values(result.metafile.outputs).flatMap((output) => output.imports);
    assert.ok(imports.some((item) => item.path === '@codemirror/state' && item.external));
    assert.ok(imports.every((item) => item.external && contentScriptExternals.includes(item.path)));
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    t.after(() => window.close());
    const module = { exports: {} };
    // Execute our production bundle with the real host-library instances, without installing the extension.
    runInNewContext(result.outputFiles[0].text, {
        module,
        exports: module.exports,
        console,
        window,
        document: window.document,
        Element: window.Element,
        require: (name) => {
            assert.ok(contentScriptExternals.includes(name), `Unexpected runtime dependency: ${name}`);
            return require(name);
        },
    });
    assert.equal(typeof module.exports.default, 'function');
    const extension = module.exports.default({ postMessage: async () => null });
    assert.equal(typeof extension.plugin, 'function');
});

test('the production bundle registers with Joplin without requiring any module', async () => {
    const result = await build({ ...createBuildOptions(root), write: false, metafile: true, logLevel: 'silent' });
    let registered = false;
    // Execute only the bundle just built from this repository. The main bundle also runs in the
    // mobile webview, which has no Node built-ins, so any runtime require is a failure.
    runInNewContext(result.outputFiles[0].text, {
        joplin: {
            plugins: {
                register: (plugin) => {
                    registered = typeof plugin.onStart === 'function';
                },
            },
        },
        console,
        setTimeout,
        clearTimeout,
        TextEncoder,
        TextDecoder,
        URL,
        URLSearchParams,
        require: (name) => {
            throw new Error(`Unexpected runtime dependency: ${name}`);
        },
    });
    assert.equal(registered, true);
});
