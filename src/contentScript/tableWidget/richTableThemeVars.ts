import { EditorView } from '@codemirror/view';

/**
 * Joplin's editor text-selection colors, which no Joplin CSS variable exposes.
 *
 * Joplin only styles selection in dark mode (`packages/editor/CodeMirror/theme.ts`); in light
 * mode it leaves the selection unstyled and CodeMirror's own base theme colors apply.  The light
 * values below are therefore CodeMirror's defaults, restated here so both modes read from one
 * place.  `--joplin-selected-color` is deliberately not used: it is the list-item selection
 * color (light `#e5e5e5`, dark `#616161`), not the text-selection color.
 */
const JOPLIN_SELECTION_COLORS = {
    light: { focused: '#d7d4f0', blurred: '#d9d9d9' },
    dark: { focused: '#6b6b6b', blurred: '#444444' },
} as const;

/**
 * Maps Joplin theme variables to plugin-owned --rt-* custom properties.
 *
 * Defined on the main editor root so all plugin DOM (widget, nested editor, toolbar)
 * inherits them via CSS cascade.  Updating a Joplin variable name means changing
 * one line here rather than hunting across multiple style files.
 *
 * --rt-border-color        borders, outlines, dividers
 * --rt-selection-bg        multi-cell selection overlay
 * --rt-nested-selection-bg CodeMirror drawSelection layer inside a focused nested editor
 * --rt-nested-selection-blurred-bg  the same layer while the nested editor is unfocused
 * --rt-code-bg             inline code background
 * --rt-code-color          inline code text
 * --rt-mark-bg             ==highlight== background
 * --rt-mark-color          ==highlight== text
 * --rt-link-color          anchor text
 * --rt-header-bg           <th> background
 * --rt-toolbar-bg          floating toolbar background
 * --rt-toolbar-color       floating toolbar text
 * --rt-toolbar-shadow      floating toolbar box-shadow color (deliberately not theme-derived:
 *                          a shadow is light occlusion, so it stays dark in every theme.  Joplin's
 *                          background-color-transparent2 is an overlay scrim that inverts to white
 *                          on dark themes, which reads as a glow rather than a shadow.)
 * --rt-toolbar-hover-bg    toolbar button hover background
 *
 * The `&light`/`&dark` blocks resolve to CodeMirror's own light/dark theme classes on the editor
 * root, so they follow the `EditorView.darkTheme` facet.  They must stay after the `&` block:
 * all three selectors are a single class, so source order decides the winner.  Any editor whose
 * DOM these variables must resolve on has to report the same facet value as the host editor —
 * see the `dark` option passed in `nestedEditor/nestedEditorTheme.ts`.
 */
export const richTableThemeVars = EditorView.baseTheme({
    '&': {
        '--rt-border-color': 'var(--joplin-divider-color, #dddddd)',
        '--rt-selection-bg': 'var(--joplin-selected-text-background-color, rgba(0, 120, 215, 0.15))',
        '--rt-code-bg': 'var(--joplin-code-background-color, rgb(243, 243, 243))',
        '--rt-code-color': 'var(--joplin-code-color, rgb(0, 0, 0))',
        '--rt-mark-bg': 'var(--joplin-mark-highlight-background-color, #F7D26E)',
        '--rt-mark-color': 'var(--joplin-mark-highlight-color, black)',
        '--rt-link-color': 'var(--joplin-url-color, #155BDA)',
        '--rt-header-bg': 'var(--joplin-table-background-color, rgb(247, 247, 247))',
        '--rt-toolbar-bg': 'var(--joplin-background-color)',
        '--rt-toolbar-color': 'var(--joplin-color)',
        '--rt-toolbar-shadow': 'rgba(0, 0, 0, 0.2)',
        '--rt-toolbar-hover-bg': 'var(--joplin-selected-color)',
    } as Record<string, string>,
    '&light': {
        '--rt-nested-selection-bg': JOPLIN_SELECTION_COLORS.light.focused,
        '--rt-nested-selection-blurred-bg': JOPLIN_SELECTION_COLORS.light.blurred,
    } as Record<string, string>,
    '&dark': {
        '--rt-nested-selection-bg': JOPLIN_SELECTION_COLORS.dark.focused,
        '--rt-nested-selection-blurred-bg': JOPLIN_SELECTION_COLORS.dark.blurred,
    } as Record<string, string>,
});
