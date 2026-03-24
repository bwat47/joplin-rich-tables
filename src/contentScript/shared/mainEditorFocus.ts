import type { EditorView } from '@codemirror/view';

/**
 * Focus the main editor without scrolling the viewport.
 */
export function focusMainEditorWithoutScroll(view: EditorView): void {
    view.contentDOM.focus({ preventScroll: true });
}
