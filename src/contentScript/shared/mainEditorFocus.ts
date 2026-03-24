import type { EditorView } from '@codemirror/view';

/**
 * Keep focus on the main editor during structural widget rebuild gaps so mobile IME
 * state is preserved until the replacement nested editor is mounted.
 */
export function handoffMainEditorFocus(view: EditorView): void {
    view.contentDOM.focus({ preventScroll: true });
}
