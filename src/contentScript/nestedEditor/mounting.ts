import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { SubviewCellRange } from './transactionPolicy';
import { CLASS_CELL_CONTENT, CLASS_CELL_EDITOR, CLASS_CELL_EDITOR_HIDDEN } from '../tableWidget/domConstants';

class HiddenWidget extends WidgetType {
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = CLASS_CELL_EDITOR_HIDDEN;
        return span;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/** Creates a decoration extension that hides all content outside the active cell range. */
export function createHideOutsideRangeExtension(rangeField: StateField<SubviewCellRange>) {
    const hiddenWidget = new HiddenWidget();

    return EditorView.decorations.compute(['doc', rangeField], (state) => {
        const { from: cellFrom, to: cellTo } = state.field(rangeField);
        const ranges: Array<{ from: number; to: number; value: Decoration }> = [];
        const docLen = state.doc.length;

        if (cellFrom > 0) {
            ranges.push({
                from: 0,
                to: cellFrom,
                value: Decoration.replace({ widget: hiddenWidget }),
            });
        }

        if (cellTo < docLen) {
            ranges.push({
                from: cellTo,
                to: docLen,
                value: Decoration.replace({ widget: hiddenWidget }),
            });
        }

        return Decoration.set(ranges.map((r) => r.value.range(r.from, r.to)));
    });
}

/** Ensures the cell element has the required structure (content div and editor host div). */
export function ensureCellWrapper(cell: HTMLElement): { content: HTMLElement; editorHost: HTMLElement } {
    let content = cell.querySelector(`:scope > .${CLASS_CELL_CONTENT}`) as HTMLElement | null;
    if (!content) {
        content = document.createElement('div');
        content.className = CLASS_CELL_CONTENT;

        while (cell.firstChild) {
            content.appendChild(cell.firstChild);
        }
        cell.appendChild(content);
    }

    let editorHost = cell.querySelector(`:scope > .${CLASS_CELL_EDITOR}`) as HTMLElement | null;
    if (!editorHost) {
        editorHost = document.createElement('div');
        editorHost.className = CLASS_CELL_EDITOR;
        editorHost.style.display = 'none';
        cell.appendChild(editorHost);
    }

    return { content, editorHost };
}
