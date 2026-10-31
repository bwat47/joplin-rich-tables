module.exports = {
    semi: true,
    trailingComma: 'es5',
    singleQuote: true,
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    plugins: ['@ianvs/prettier-plugin-sort-imports'],
    // Packages first, then the Joplin `api` path alias and relative imports. Side-effect imports stay in place.
    importOrder: ['<BUILTIN_MODULES>', '<THIRD_PARTY_MODULES>', '', '^api(/.*)?$', '^[.]'],
    // Lets the plugin merge `import type` into inline `type` specifiers, matching import-x/no-duplicates prefer-inline.
    importOrderTypeScriptVersion: '6.0.0',
};
