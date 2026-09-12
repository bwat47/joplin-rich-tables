import { EditorView, ViewPlugin } from '@codemirror/view';
import { isNestedEditorOpen } from '../../nestedEditor/nestedEditorController';
import { handleSelectionCopy, handleSelectionCut, handleTableClipboardPaste } from './cellSelectionClipboard';

/**
 * Document-level clipboard wiring for table cell selections.
 *
 * Kept separate from `cellSelectionClipboard` so that module stays free of nested-editor
 * imports: `nestedEditorController` pulls in the nested editor's DOM handlers, which in turn
 * use the clipboard module's paste logic.
 */
export const cellSelectionClipboardPlugin = ViewPlugin.fromClass(
    class {
        private readonly onCopy: (event: ClipboardEvent) => void;
        private readonly onCut: (event: ClipboardEvent) => void;
        private readonly onPaste: (event: ClipboardEvent) => void;

        constructor(private readonly view: EditorView) {
            this.onCopy = (event) => {
                handleSelectionCopy(event, this.view);
            };
            this.onCut = (event) => {
                handleSelectionCut(event, this.view);
            };
            this.onPaste = (event) => {
                handleTableClipboardPaste(event, this.view, {
                    nestedEditorOpen: isNestedEditorOpen(this.view),
                });
            };

            const doc = this.view.dom.ownerDocument;
            doc.addEventListener('copy', this.onCopy, true);
            doc.addEventListener('cut', this.onCut, true);
            doc.addEventListener('paste', this.onPaste, true);
        }

        destroy(): void {
            const doc = this.view.dom.ownerDocument;
            doc.removeEventListener('copy', this.onCopy, true);
            doc.removeEventListener('cut', this.onCut, true);
            doc.removeEventListener('paste', this.onPaste, true);
        }
    }
);
