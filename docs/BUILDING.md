# Building the plugin

Requires Node 22 or later. Install dependencies with `npm ci`, then run `npm run dist`. The build checks
TypeScript once with `tsc --noEmit`, bundles with esbuild, and packages the result.

- `dist/index.js`: main plugin bundle, using Joplin's injected API object.
- `dist/contentScript/tableWidgetExtension.js`: independent CommonJS content-script
  bundle with a default-exported factory, at the path registered by the main plugin.
- Non-TypeScript files under `src/` are copied into `dist/` before bundling.
- `publish/com.bwat47.rich-tables.jpl`: portable tar archive with runtime files at
  its root. The matching `.json` contains the manifest, archive SHA-256 hash, and
  Git branch/commit (empty outside a Git checkout).

`scripts/buildConfig.mjs` holds bundler settings. Both bundles target ES2020, define
`process.env.NODE_ENV` as `"production"`, and build concurrently. The `api` import resolves
through `tsconfig.json` `paths`. Extra scripts come from `plugin.config.json`; their paths are
relative to `src/` and retain their directory structure with a `.js` extension.
The explicit CodeMirror/Lezer external list preserves Joplin's shared instances.
Floating UI, DOMPurify, and other runtime dependencies are bundled. The main bundle uses
esbuild's node platform, so a Node built-in import would stay a runtime `require`; it also runs
in the mobile webview, so `npm test` fails if the main bundle requires any module. Content
scripts use the browser platform, where a Node built-in import fails the build.
Each build clears only the project-local `dist/` and `publish/`.
Build, validation, and packaging errors fail the command.

Run `npm run updateVersion` to increment the patch version in `package.json`,
`src/manifest.json`, and both package-lock version entries together. Only the version
value changes in `package.json` and the manifest; their formatting is preserved. Package
and manifest versions must match before building or updating versions.

The generator's Webpack scaffold and `npm run update` have been replaced.
Run `npm run updateApi` to replace only `api/` from the latest `generator-joplin`
package, then review `git diff api/` and run `npm run typecheck`. The new `api/` is staged
beside the old one and swapped in by rename, so a failed update leaves `api/` unchanged.
The script also warns when the generator's plugin categories or content-script externals
differ from `VALID_CATEGORIES` (`scripts/packagePlugin.mjs`) or `contentScriptExternals`
(`scripts/buildConfig.mjs`), which are otherwise maintained by hand.

## Verification

- `npm test`: application tests, packaging checks, and production-bundle smoke tests.
- `npm run typecheck`: TypeScript checking without output.
- `npm run lint`: application and build-script lint checks.
- `npm run knip`: unused dependencies, exports, and files.
- `npm run dist`: full build and archive generation.

Before releasing, install the `.jpl` in Joplin on desktop and mobile. Check table
rendering, nested cell editing, structural commands, search, and undo/redo.
