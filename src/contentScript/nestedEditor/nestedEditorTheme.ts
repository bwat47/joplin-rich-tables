import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { CELL_PADDING } from '../tableWidget/cellGeometry';
import { CLASS_NESTED_EDITOR_URL } from '../shared/tableDomClasses';

/**
 * Creates a theme for the nested cell editor that adapts to light/dark mode.
 * Configures selection highlighting, scrolling behavior, and syntax decoration styles.
 *
 * The `dark` option propagates the host editor's `EditorView.darkTheme` facet to this view, which
 * is what stamps CodeMirror's light/dark theme class onto the nested editor root.  Without it the
 * nested root always reports "light" and shadows the host's `--rt-*` selection variables with the
 * light values (see `tableWidget/richTableThemeVars.ts`).
 */
export function createNestedEditorTheme(isDarkTheme: boolean): Extension {
    return EditorView.theme(
        {
            '&': {
                backgroundColor: 'transparent',
            },

            // --- Selection rendering ---
            // The browser paints the selection, so an open cell and the rendered cells around it
            // are highlighted by the same engine; `rootEditorSelectionTheme.ts` colours it and
            // explains why the rectangles this layer would draw do not suit a table cell.
            //
            // `drawSelection` stays for the caret alone: CodeMirror has no other source of
            // `.cm-cursor`, and the host editor's own `drawSelection` blanks the native caret
            // throughout its DOM, the nested editor included.
            '& .cm-selectionLayer': {
                display: 'none',
            },

            // --- Joplin/CM environment resets ---
            // These override Joplin's and CodeMirror's aggressive defaults that would
            // otherwise break cell layout or mismatch the rendered cell appearance.
            '.cm-scroller': {
                overflow: 'hidden !important',
            },
            '.cm-content': {
                // Same inset as the rendered wrapper (`tableWidget/cellGeometry.ts`). Joplin's
                // `.cm-content` padding carries `!important`; `tableStyles.ts` is what actually
                // lands it on this editor.
                padding: CELL_PADDING,
                // CodeMirror injects font-size: 1.1875em on mobile to prevent iOS/Android auto-zoom.
                // Override so the editor font matches the rendered cell (which uses inherit).
                fontSize: 'inherit !important',
                // CodeMirror's `lineWrapping` uses break-spaces/break-word; override to match
                // rendered-table behavior (wrap at whitespace, but don't split short words).
                // `break-spaces` makes a space at a wrap point occupy width and count toward
                // intrinsic sizing, while the rendered cell (`white-space: normal`) lets it hang
                // for free, so the same text measured wider and wrapped earlier in the editor,
                // shifting column widths on activation. `pre-wrap` keeps source spaces intact
                // while restoring hanging at wrap points.
                whiteSpace: 'pre-wrap !important',
                wordBreak: 'normal !important',
                overflowWrap: 'normal !important',
            },
            '.cm-line': {
                // The inset belongs to `.cm-content`; CodeMirror's own `0 2px` would add to it.
                padding: '0 !important',
                wordBreak: 'normal !important',
                overflowWrap: 'normal !important',
            },

            // --- Syntax decoration styles ---
            '.cm-inline-code': {
                borderRadius: '4px',
                border: `1px solid ${isDarkTheme ? 'rgba(200, 200, 200, 0.5)' : 'rgba(100, 100, 100, 0.5)'}`,
                padding: '1px 0',
            },
            '.cm-highlighted': {
                backgroundColor: 'var(--rt-mark-bg)',
                color: 'var(--rt-mark-color)',
                padding: '1px 0',
                borderRadius: '2px',
            },
            '.cm-inserted': {
                textDecoration: 'underline',
                textDecorationStyle: 'solid',
            },
            [`.${CLASS_NESTED_EDITOR_URL}`]: {
                // URL source can be substantially wider than its rendered link label. Allowing
                // breaks at any character keeps it from increasing the table's intrinsic width.
                overflowWrap: 'anywhere',
            },
        },
        { dark: isDarkTheme }
    );
}
