import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';

/**
 * Creates a theme for the nested cell editor that adapts to light/dark mode.
 * Configures selection highlighting, scrolling behavior, and syntax decoration styles.
 */
export function createNestedEditorTheme(isDarkTheme: boolean): Extension {
    return EditorView.theme({
        '&': {
            backgroundColor: 'transparent',
        },

        // --- Selection rendering ---
        // CM's drawSelection() paints .cm-selectionBackground; style its color here.
        // Native ::selection suppression is handled on the root editor in
        // rootEditorSelectionTheme.ts, which has higher specificity than Joplin's
        // cascading `&.cm-focused ::selection` rule.
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
            backgroundColor: 'var(--rt-nested-selection-bg) !important',
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
            // CodeMirror's `lineWrapping` uses break-word; override to match rendered-table behavior
            // (wrap at whitespace, but don't split short words).
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
    });
}
