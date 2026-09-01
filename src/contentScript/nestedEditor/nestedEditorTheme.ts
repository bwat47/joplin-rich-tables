import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { CLASS_NESTED_EDITOR_LINK } from '../shared/tableDomClasses';

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
            // CM's drawSelection() paints .cm-selectionBackground; style its color here.  The
            // focused selector mirrors Joplin's own (theme.ts) and outranks the blurred rule
            // above it on specificity, so ordering here is presentational only.
            // Native ::selection suppression is handled on the root editor in
            // rootEditorSelectionTheme.ts, which has higher specificity than Joplin's
            // cascading `&.cm-focused ::selection` rule.
            '& .cm-selectionLayer .cm-selectionBackground': {
                backgroundColor: 'var(--rt-selection-blurred-bg) !important',
            },
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
                backgroundColor: 'var(--rt-selection-focused-bg) !important',
            },

            // --- Joplin/CM environment resets ---
            // These override Joplin's and CodeMirror's aggressive defaults that would
            // otherwise break cell layout or mismatch the rendered cell appearance.
            '.cm-scroller': {
                overflow: 'hidden !important',
            },
            '.cm-content': {
                padding: '0',
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
                paddingLeft: '1px !important',
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
            [`.${CLASS_NESTED_EDITOR_LINK}`]: {
                // A link's source can be substantially wider than what it renders to, so it is
                // allowed to break at any character. `anywhere` rather than `break-word` because
                // only `anywhere` lowers min-content width, and `.cm-content` is a flex item whose
                // automatic minimum size is exactly that: under `break-word` an unbreakable label
                // holds the item above the width cap in `tableStyles.ts` and the hidden scroller
                // clips it instead of wrapping it. Breaks still prefer whitespace, so a label with
                // spaces wraps between words the way the rendered cell does.
                overflowWrap: 'anywhere',
            },
        },
        { dark: isDarkTheme }
    );
}
