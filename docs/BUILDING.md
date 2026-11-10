# Building the plugin

Requires Node 22 or later. Install dependencies and build the plugin:

```sh
npm ci
npm run dist
```

The build checks TypeScript, then runs `joplin-plugin-scripts build` from the shared
`@bwat47/joplin-plugin-scripts` dev dependency, which bundles with esbuild and creates:

- `dist/`: the plugin bundles and runtime assets, without tests or fixtures.
- `publish/com.bwat47.rich-tables.jpl`: the installable plugin.
- `publish/com.bwat47.rich-tables.json`: publish metadata.

Each build clears `dist/` and `publish/` first. Extra content scripts are read from
`plugin.config.json`. Content scripts target the browser and keep Joplin's CodeMirror
and Lezer libraries external.

Build, packaging, version, and API-update behavior lives in the shared package. Change it
there and update the dependency here, rather than adding local build scripts.

## Maintenance

- `npm run updateVersion`: increment the patch version in `package.json`,
  `src/manifest.json`, and `package-lock.json` together. Their versions must match
  before bumping.
- `npm run updateApi`: update `api/` from the latest `generator-joplin` package
  without regenerating the project. Review `git diff api/` and run `npm run typecheck`
  afterward. Category or content-script external warnings mean the shared package
  needs updating.

## Verification

- `npm test`: run the Vitest suite.
- `npm run typecheck`: check TypeScript without producing output.
- `npm run lint`: lint application sources.
- `npm run knip`: check for unused dependencies, exports, and files.
- `npm run dist`: build and package the plugin.

Before releasing, install the `.jpl` in Joplin on desktop and mobile. Check table
rendering, nested cell editing, structural commands, search, and undo/redo.
