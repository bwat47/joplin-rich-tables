# Building the plugin

Requires Node 22 or later. Install dependencies and build the plugin:

```sh
npm ci
npm run dist
```

The build checks TypeScript, bundles with esbuild, and creates:

- `dist/`: the plugin bundles and runtime assets.
- `publish/com.bwat47.rich-tables.jpl`: the installable plugin.
- `publish/com.bwat47.rich-tables.json`: publish metadata.

Each build clears `dist/` and `publish/` first.

## Maintenance

- `npm run updateVersion`: increment the patch version in `package.json`,
  `src/manifest.json`, and `package-lock.json` together. Their versions must match
  before bumping.
- `npm run updateApi`: update `api/` from the latest `generator-joplin` package
  without regenerating the project. Review `git diff api/`, address any category
  or content-script external warnings, and run `npm run typecheck` afterward.

## Verification

- `npm test`: run application and build-tool tests.
- `npm run typecheck`: check TypeScript without producing output.
- `npm run lint`: lint application sources and build scripts.
- `npm run knip`: check for unused dependencies, exports, and files.
- `npm run dist`: build and package the plugin.

Before releasing, install the `.jpl` in Joplin on desktop and mobile. Check table
rendering, nested cell editing, structural commands, search, and undo/redo.
