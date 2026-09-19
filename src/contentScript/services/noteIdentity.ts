import { Facet } from '@codemirror/state';

/**
 * The ID of the note the editor is showing, mirrored from Joplin's own note ID facet.
 * Null when the host has not provided one, such as before the plugin is registered.
 */
export const noteIdentityFacet = Facet.define<string, string | null>({
    combine: (values) => values[0] ?? null,
});
