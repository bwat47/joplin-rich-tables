import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

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
            // No `drawSelection`: the browser paints the caret and selection, so an open cell and
            // the rendered cells around it are highlighted by the same engine, and iOS keeps its
            // native selection handles. `tableWidget/rootEditorSelectionTheme.ts` colours both,
            // overriding the blanking the host editor's own `drawSelection` applies throughout its DOM.

            // --- Joplin/CM environment resets ---
            // These override Joplin's and CodeMirror's aggressive defaults that would
            // otherwise break cell layout or mismatch the rendered cell appearance.
            //
            // The cell's inset is not among them: it is declared on `.cm-content` in
            // `tableWidget/tableStyles.ts`, whose selectors carry the `!important` that
            // Joplin's own `.cm-content` padding demands, and which zeroes `.cm-line` so
            // CodeMirror's `0 2px` does not add to it.
            '.cm-scroller': {
                overflow: 'hidden !important',
            },
            '.cm-content': {
                // CodeMirror injects font-size: 1.1875em on mobile to prevent iOS/Android auto-zoom.
                // Override so the editor font matches the rendered cell (which uses inherit).
                fontSize: 'inherit !important',
                // CodeMirror's `lineWrapping` uses break-spaces/break-word; override the word
                // breaking to match rendered-table behavior (wrap at whitespace, but don't split
                // short words). white-space stays `break-spaces`, the same mode the rendered cell
                // declares, so typed spaces at a wrap point stay visible and text measures the
                // same width on activation.
                wordBreak: 'normal !important',
                overflowWrap: 'normal !important',
            },
            '.cm-line': {
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
