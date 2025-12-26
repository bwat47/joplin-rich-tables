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
        // CodeMirror draws the selection background in a separate layer.
        // Make the browser's native selection highlight transparent so we don't see
        // the default blue overlay on top of CodeMirror's highlight.
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
            backgroundColor: 'var(--joplin-selected-color, #6B6B6B) !important',
        },
        // NOTE: `::selection` must be attached to an element selector.
        // Make the native highlight transparent inside the nested editor.
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

        '.cm-scroller': {
            overflow: 'hidden !important',
        },
        '.cm-content': {
            padding: '0',
            overflowWrap: 'normal',
            wordBreak: 'normal',
        },
        '.cm-inline-code': {
            borderRadius: '4px',
            border: `1px solid ${isDarkTheme ? 'rgba(200, 200, 200, 0.5)' : 'rgba(100, 100, 100, 0.5)'}`,
            padding: '1px 2px',
        },
        '.cm-highlighted': {
            backgroundColor: 'var(--joplin-mark-highlight-background-color, #F7D26E)',
            color: 'var(--joplin-mark-highlight-color, black)',
            padding: '1px 2px',
            borderRadius: '2px',
        },
        '.cm-inserted': {
            textDecoration: 'underline',
            textDecorationStyle: 'solid',
        },
    });
}
