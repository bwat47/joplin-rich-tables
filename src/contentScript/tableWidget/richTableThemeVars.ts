import { EditorView } from '@codemirror/view';

/**
 * Maps Joplin theme variables to plugin-owned --rt-* custom properties.
 *
 * Defined on the main editor root so all plugin DOM (widget, nested editor, toolbar)
 * inherits them via CSS cascade.  Updating a Joplin variable name means changing
 * one line here rather than hunting across multiple style files.
 *
 * --rt-border-color        borders, outlines, dividers
 * --rt-selection-bg        multi-cell selection overlay
 * --rt-nested-selection-bg CodeMirror drawSelection layer inside nested editor
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
 */
export const richTableThemeVars = EditorView.baseTheme({
    '&': {
        '--rt-border-color': 'var(--joplin-divider-color, #dddddd)',
        '--rt-selection-bg': 'var(--joplin-selected-text-background-color, rgba(0, 120, 215, 0.15))',
        '--rt-nested-selection-bg': 'var(--joplin-selected-color, #6B6B6B)',
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
});
