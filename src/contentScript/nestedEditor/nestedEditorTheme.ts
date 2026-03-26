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

        // --- Selection conflict overrides ---
        // The main Joplin CM editor applies `&.cm-focused ::selection { ... }` which
        // targets ALL descendants, including the nested editor DOM. The nested editor
        // uses CM's drawSelection(), which paints its own .cm-selectionBackground layer.
        // If the browser's native ::selection overlay also fires, both paint simultaneously.
        // Force ::selection to transparent here so the native overlay never wins.
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
            backgroundColor: 'var(--rt-nested-selection-bg) !important',
        },
        // NOTE: `::selection` must be attached to an element selector.
        // Joplin applies `&.cm-focused ::selection` on the *main* editor, and the
        // nested editor lives inside the main editor DOM. Use higher specificity
        // + !important so the browser's default blue overlay never wins here.
        '&.cm-editor.cm-focused .cm-content::selection, &.cm-editor.cm-focused .cm-content *::selection': {
            backgroundColor: 'transparent !important',
            color: 'inherit !important',
        },
        '&.cm-editor .cm-content::selection, &.cm-editor .cm-content *::selection': {
            backgroundColor: 'transparent !important',
            color: 'inherit !important',
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
